'use strict';

const API_BASE = 'https://adsplus-api-staging.onrender.com';
const RUNTIME_CONFIG_KEY = 'adsplus_runtime_config_v1';
const DEVICE_KEY = 'adsplus_device_v1';
const LOCAL_CONFIG_KEY = 'adsplus_cfg';
const CONFIG_MAX_AGE_MS = 60 * 1000;

let deviceRegistrationFlight = null;

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function apiFetch(path, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const requestOptions = Object.assign({
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error'
  }, options || {});
  requestOptions.signal = controller.signal;

  try {
    return await fetch(API_BASE + path, requestOptions);
  } finally {
    clearTimeout(timeout);
  }
}

function validRuntimeConfig(config) {
  return !!config &&
    config.version === 1 &&
    typeof config.enabled === 'boolean' &&
    !!config.platforms &&
    typeof config.platforms.chatgpt === 'boolean' &&
    typeof config.platforms.claude === 'boolean' &&
    typeof config.platforms.gemini === 'boolean' &&
    typeof config.mobile_enabled === 'boolean' &&
    typeof config.link_enabled === 'boolean' &&
    config.ad_type === 'link' &&
    config.min_dwell_ms === 5000;
}

async function getRuntimeConfig(forceRefresh) {
  const stored = await storageGet([RUNTIME_CONFIG_KEY]);
  const cached = stored[RUNTIME_CONFIG_KEY];

  if (!forceRefresh &&
      cached &&
      Number.isFinite(cached.saved_at) &&
      Date.now() - cached.saved_at < CONFIG_MAX_AGE_MS &&
      validRuntimeConfig(cached.config)) {
    return cached.config;
  }

  const response = await apiFetch('/v1/config');
  if (!response.ok) throw new Error('config_http_' + response.status);

  const config = await response.json();
  if (!validRuntimeConfig(config)) throw new Error('bad_public_config');

  await storageSet({
    [RUNTIME_CONFIG_KEY]: {
      config: config,
      saved_at: Date.now()
    }
  });

  return config;
}

async function registerDevice(device) {
  const response = await apiFetch('/v1/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: device.device_id,
      install_secret: device.install_secret
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 409 &&
        body.error === 'rotation_cooldown' &&
        device.device_token &&
        Date.parse(device.token_expires_at || '') > Date.now() + 5000) {
      return device;
    }
    throw new Error(body.error || ('device_register_http_' + response.status));
  }

  if (typeof body.device_token !== 'string' ||
      typeof body.token_expires_at !== 'string') {
    throw new Error('bad_device_registration_response');
  }

  device.device_token = body.device_token;
  device.token_expires_at = body.token_expires_at;
  await storageSet({ [DEVICE_KEY]: device });
  return device;
}

async function ensureDevice(forceRotate) {
  if (deviceRegistrationFlight) return deviceRegistrationFlight;

  deviceRegistrationFlight = (async () => {
    const stored = await storageGet([DEVICE_KEY]);
    let device = stored[DEVICE_KEY] || {};

    if (typeof device.device_id !== 'string' ||
        typeof device.install_secret !== 'string') {
      device = {
        device_id: 'adsplus-v5-' + randomHex(16),
        install_secret: randomHex(32),
        device_token: null,
        token_expires_at: null
      };
      await storageSet({ [DEVICE_KEY]: device });
    }

    const expiresAt = Date.parse(device.token_expires_at || '');
    if (!forceRotate &&
        typeof device.device_token === 'string' &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now() + 60000) {
      return device;
    }

    return registerDevice(device);
  })();

  try {
    return await deviceRegistrationFlight;
  } finally {
    deviceRegistrationFlight = null;
  }
}

async function requestWithDeviceToken(path, device, options) {
  const headers = Object.assign({}, (options && options.headers) || {}, {
    Authorization: 'Bearer ' + device.device_token
  });
  return apiFetch(path, Object.assign({}, options || {}, { headers: headers }));
}

async function serveAd(platform, mobile) {
  if (!['chatgpt', 'claude', 'gemini'].includes(platform)) {
    throw new Error('unsupported_platform');
  }

  const config = await getRuntimeConfig(false);
  if (!config.enabled ||
      !config.link_enabled ||
      !config.platforms[platform] ||
      (mobile && !config.mobile_enabled)) {
    return { ad: null, reason: 'feature_disabled' };
  }

  let device = await ensureDevice(false);
  let response = await requestWithDeviceToken('/v1/ads/serve', device, {
    method: 'POST'
  });

  if (response.status === 401) {
    device = await ensureDevice(true);
    response = await requestWithDeviceToken('/v1/ads/serve', device, {
      method: 'POST'
    });
  }

  if (response.status === 204) return { ad: null, reason: 'no_campaign' };

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || ('serve_http_' + response.status));
  }

  const ad = body.ad;
  const serveId = body.serve_id;
  const clickUrl = body.click_url;

  if (!ad ||
      typeof ad.title !== 'string' ||
      !ad.title.trim() ||
      typeof serveId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(serveId) ||
      typeof clickUrl !== 'string') {
    throw new Error('invalid_served_ad');
  }

  const parsedClickUrl = new URL(clickUrl);
  if (parsedClickUrl.protocol !== 'https:' ||
      parsedClickUrl.hostname !== new URL(API_BASE).hostname ||
      !parsedClickUrl.pathname.startsWith('/go/')) {
    throw new Error('invalid_click_url');
  }

  return {
    ad: {
      id: String(ad.id || ''),
      title: ad.title.slice(0, 80),
      body: typeof ad.body === 'string' ? ad.body.slice(0, 200) : '',
      cta_text: typeof ad.cta_text === 'string' ? ad.cta_text.slice(0, 24) : 'Learn more'
    },
    serve_id: serveId,
    click_url: parsedClickUrl.href
  };
}

async function recordImpression(payload) {
  if (!payload ||
      typeof payload.serve_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(payload.serve_id) ||
      !Number.isInteger(payload.dwell_ms) ||
      payload.dwell_ms < 5000 ||
      typeof payload.idempotency_key !== 'string' ||
      payload.idempotency_key.length < 8 ||
      payload.idempotency_key.length > 128) {
    throw new Error('invalid_impression_payload');
  }

  const requestBody = JSON.stringify({
    serve_id: payload.serve_id,
    type: 'impression',
    dwell_ms: payload.dwell_ms,
    idempotency_key: payload.idempotency_key
  });

  let device = await ensureDevice(false);
  let response = await requestWithDeviceToken('/v1/ad-impressions', device, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody
  });

  if (response.status === 401) {
    device = await ensureDevice(true);
    response = await requestWithDeviceToken('/v1/ad-impressions', device, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody
    });
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || ('impression_http_' + response.status));
  }
  return body;
}

chrome.runtime.onInstalled.addListener(() => {
  storageGet([LOCAL_CONFIG_KEY]).then((stored) => {
    const current = stored[LOCAL_CONFIG_KEY] || {};
    return storageSet({
      [LOCAL_CONFIG_KEY]: Object.assign({
        enabled: true,
        link: true,
        video: false,
        sticky: false
      }, current)
    });
  }).catch((error) => {
    console.error('[Ads+] settings initialization failed:', error.message);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  let task;
  if (message.type === 'ADSPLUS_GET_CONFIG') {
    task = getRuntimeConfig(!!message.refresh);
  } else if (message.type === 'ADSPLUS_SERVE_AD') {
    task = serveAd(message.platform, !!message.mobile);
  } else if (message.type === 'ADSPLUS_RECORD_IMPRESSION') {
    task = recordImpression(message.payload);
  } else {
    return false;
  }

  task.then((data) => {
    sendResponse({ ok: true, data: data });
  }).catch((error) => {
    console.warn('[Ads+] API request failed:', error.message);
    sendResponse({ ok: false, error: error.message || 'request_failed' });
  });

  return true;
});
