'use strict';

// This package is deliberately pinned to the Ads+ STAGING API.
// Change this constant only in a separately reviewed production release.
const API_BASE = 'https://adsplus-api-staging.onrender.com';
const LOCAL_CONFIG_KEY = 'adsplus_cfg';
const DEVICE_KEY = 'adsplus_device_v1';
const RUNTIME_CONFIG_KEY = 'adsplus_runtime_config_v1';
const CONFIG_MAX_AGE_MS = 60_000;

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value || {});
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

function randomHex(bytes) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(API_BASE + path, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error'
    });
  } finally {
    clearTimeout(timeout);
  }
}

function validRuntimeConfig(config) {
  return !!config && config.version === 1 &&
    typeof config.enabled === 'boolean' &&
    !!config.platforms &&
    typeof config.platforms.chatgpt === 'boolean' &&
    typeof config.platforms.claude === 'boolean' &&
    typeof config.platforms.gemini === 'boolean' &&
    typeof config.mobile_enabled === 'boolean' &&
    typeof config.link_enabled === 'boolean' &&
    config.ad_type === 'link' && config.min_dwell_ms === 5000;
}

async function getRuntimeConfig(forceRefresh = false) {
  const stored = await storageGet([RUNTIME_CONFIG_KEY]);
  const cached = stored[RUNTIME_CONFIG_KEY];
  if (!forceRefresh && cached && Number.isFinite(cached.saved_at) &&
      Date.now() - cached.saved_at < CONFIG_MAX_AGE_MS &&
      validRuntimeConfig(cached.config)) {
    return cached.config;
  }

  const response = await apiFetch('/v1/config', { method: 'GET' });
  if (!response.ok) throw new Error('config_http_' + response.status);
  const config = await response.json();
  if (!validRuntimeConfig(config)) throw new Error('bad_public_config');
  await storageSet({ [RUNTIME_CONFIG_KEY]: { config, saved_at: Date.now() } });
  return config;
}

async function ensureDevice(forceRotate = false) {
  const stored = await storageGet([DEVICE_KEY]);
  let device = stored[DEVICE_KEY] || {};

  if (!device.device_id || !device.install_secret) {
    device = {
      device_id: 'adsplus-v5-' + randomHex(16),
      install_secret: randomHex(32),
      device_token: null,
      token_expires_at: null
    };
  }

  const expiresAt = device.token_expires_at ? Date.parse(device.token_expires_at) : 0;
  if (!forceRotate && device.device_token && Number.isFinite(expiresAt) &&
      expiresAt > Date.now() + 60_000) {
    return device;
  }

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
    // A recently rotated token remains usable during the server's cooldown.
    if (response.status === 409 && body.error === 'rotation_cooldown' && device.device_token) {
      return device;
    }
    throw new Error(body.error || ('device_register_http_' + response.status));
  }

  if (typeof body.device_token !== 'string' || !body.token_expires_at) {
    throw new Error('bad_device_registration_response');
  }

  device.device_token = body.device_token;
  device.token_expires_at = body.token_expires_at;
  await storageSet({ [DEVICE_KEY]: device });
  return device;
}

async function serveAd(platform, mobile) {
  if (!['chatgpt', 'claude', 'gemini'].includes(platform)) {
    throw new Error('unsupported_platform');
  }
  const config = await getRuntimeConfig();
  if (!config.enabled || !config.link_enabled || !config.platforms[platform] ||
      (mobile && !config.mobile_enabled)) {
    return { ad: null, reason: 'feature_disabled' };
  }

  let device = await ensureDevice();
  let response = await apiFetch('/v1/ads/serve', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + device.device_token }
  });
  if (response.status === 401) {
    device = await ensureDevice(true);
    response = await apiFetch('/v1/ads/serve', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + device.device_token }
    });
  }
  if (response.status === 204) return { ad: null, reason: 'no_campaign' };
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || ('serve_http_' + response.status));

  const ad = body.ad;
  const clickUrl = typeof body.click_url === 'string' ? body.click_url : '';
  if (!ad || typeof ad.title !== 'string' || !ad.title.trim() ||
      !/^https:\/\//i.test(clickUrl)) {
    throw new Error('invalid_served_ad');
  }

  return {
    ad: {
      id: String(ad.id || ''),
      title: ad.title.slice(0, 80),
      body: typeof ad.body === 'string' ? ad.body.slice(0, 200) : '',
      cta_text: typeof ad.cta_text === 'string' ? ad.cta_text.slice(0, 24) : 'Learn more'
    },
    serve_id: body.serve_id,
    click_url: clickUrl
  };
}

async function recordImpression(payload) {
  if (!payload || typeof payload.serve_id !== 'string' ||
      !Number.isInteger(payload.dwell_ms) || payload.dwell_ms < 5000 ||
      typeof payload.idempotency_key !== 'string' ||
      payload.idempotency_key.length < 8 || payload.idempotency_key.length > 128) {
    throw new Error('invalid_impression_payload');
  }
  const device = await ensureDevice();
  let response = await apiFetch('/v1/ad-impressions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + device.device_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      serve_id: payload.serve_id,
      type: 'impression',
      dwell_ms: payload.dwell_ms,
      idempotency_key: payload.idempotency_key
    })
  });
  if (response.status === 401) {
    const rotated = await ensureDevice(true);
    response = await apiFetch('/v1/ad-impressions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + rotated.device_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        serve_id: payload.serve_id,
        type: 'impression',
        dwell_ms: payload.dwell_ms,
        idempotency_key: payload.idempotency_key
      })
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || ('impression_http_' + response.status));
  return body;
}

chrome.runtime.onInstalled.addListener(() => {
  storageGet([LOCAL_CONFIG_KEY]).then((stored) => {
    const current = stored[LOCAL_CONFIG_KEY] || {};
    return storageSet({
      [LOCAL_CONFIG_KEY]: {
        enabled: current.enabled !== false,
        link: current.link !== false
      }
    });
  }).catch((error) => console.error('[Ads+] config init failed:', error.message));
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

  task.then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.warn('[Ads+] request failed:', error.message);
      sendResponse({ ok: false, error: error.message || 'request_failed' });
    });
  return true;
});
