'use strict';

(function () {
  const host = location.hostname;
  const platform = /(^|\\.)chatgpt\\.com$/.test(host) ? 'chatgpt'
    : /(^|\\.)claude\\.ai$/.test(host) ? 'claude'
    : /(^|\\.)gemini\\.google\\.com$/.test(host) ? 'gemini' : null;
  if (!platform) return;

  const selectors = {
    chatgpt: {
      send: '[data-testid="send-button"], button[data-composer-submit], form button[type="submit"][aria-label="Send"]',
      composer: '#prompt-textarea, [data-mobile-composer-prompt], [data-composer-markdown]',
      user: '[data-message-author-role="user"], [data-user-message-bubble]'
    },
    claude: {
      send: 'button[aria-label="Send message"]',
      composer: '[data-testid="chat-input"], [contenteditable="true"][data-testid="chat-input"]',
      user: '[data-testid="user-message"], [data-cds="UserMessage"], [data-user-message-bubble]'
    },
    gemini: {
      send: 'button[aria-label="Send message"]',
      composer: 'rich-textarea [contenteditable], [contenteditable="true"]',
      user: 'user-query'
    }
  }[platform];

  const LOCAL_KEY = 'adsplus_cfg';
  let localConfig = { enabled: true, link: true };
  let effectiveEnabled = false;
  let boundSend = null;
  let boundComposer = null;
  let attachObserver = null;
  let submitObserver = null;
  let configTimer = null;
  let activeHost = null;
  let activeServeId = null;
  let dwellTimer = null;
  let dwellElapsed = 0;
  let dwellLast = 0;
  let impressionSent = false;

  function log() { console.info('[Ads+ V5.1]', ...arguments); }
  function warn() { console.warn('[Ads+ V5.1]', ...arguments); }
  function q(selector) {
    try { return selector ? document.querySelector(selector) : null; } catch (_) { return null; }
  }
  function qa(selector) {
    try { return selector ? document.querySelectorAll(selector) : []; } catch (_) { return []; }
  }
  function lastUser() {
    const nodes = qa(selectors.user);
    return nodes.length ? nodes[nodes.length - 1] : null;
  }
  function keyOf(el) {
    if (!el) return null;
    return el.getAttribute('data-message-id') ||
      (el.closest && el.closest('li[id]') ? el.closest('li[id]').id : null) || el;
  }
  function isMobile() {
    return window.innerWidth <= 768 ||
      !!(navigator.userAgentData && navigator.userAgentData.mobile) ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  }
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response && response.error || 'background_unavailable'));
        resolve(response.data);
      });
    });
  }
  function widen(el) {
    if (!el) return null;
    let current = el;
    const width = el.getBoundingClientRect().width || 1;
    for (let i = 0; i < 6; i += 1) {
      const parent = current.parentElement;
      if (!parent || parent === document.body) return null;
      if (parent.parentElement === document.body) return current;
      if (parent.getBoundingClientRect().width >= width * 1.25) return parent;
      current = parent;
    }
    return current.parentElement !== document.body ? current : null;
  }
  function anchorFor(user) {
    if (!user) return null;
    if (platform === 'gemini') return user;
    if (platform === 'chatgpt') {
      const unit = user.closest && user.closest('[data-chatgpt-search-unit-key]');
      if (unit && unit.parentElement) return unit.parentElement;
    }
    if (platform === 'claude') {
      const message = user.closest && user.closest('[data-cds="UserMessage"]');
      if (message && message.parentElement) return message.parentElement;
    }
    const anchor = widen(user);
    if (!anchor || anchor === document.body || anchor === document.documentElement ||
        anchor.parentElement === document.body) return null;
    return anchor;
  }
  function stopDwell() {
    if (dwellTimer) clearInterval(dwellTimer);
    dwellTimer = null;
    dwellElapsed = 0;
    dwellLast = 0;
  }
  function hideAd() {
    stopDwell();
    if (activeHost && activeHost.parentNode) activeHost.parentNode.removeChild(activeHost);
    activeHost = null;
    activeServeId = null;
    impressionSent = false;
  }
  function idempotencyKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
  }
  async function recordVisibleImpression() {
    if (impressionSent || !activeServeId) return;
    impressionSent = true;
    try {
      const result = await sendMessage({
        type: 'ADSPLUS_RECORD_IMPRESSION',
        payload: {
          serve_id: activeServeId,
          dwell_ms: Math.max(5000, Math.floor(dwellElapsed)),
          idempotency_key: idempotencyKey()
        }
      });
      log('impression recorded', result && result.already ? '(already)' : '');
    } catch (error) {
      warn('impression failed:', error.message);
    }
  }
  function startDwell() {
    stopDwell();
    dwellLast = Date.now();
    dwellTimer = setInterval(() => {
      const now = Date.now();
      const rect = activeHost && activeHost.getBoundingClientRect();
      const visible = !!rect && document.visibilityState === 'visible' &&
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
        rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      if (visible) dwellElapsed += now - dwellLast;
      dwellLast = now;
      if (!activeHost || !activeHost.isConnected) {
        stopDwell();
      } else if (dwellElapsed >= 5000) {
        stopDwell();
        recordVisibleImpression();
      }
    }, 250);
  }
  function showAd(result, user) {
    if (!effectiveEnabled || !result || !result.ad || !result.serve_id || !result.click_url) return;
    hideAd();
    const anchor = anchorFor(user);
    if (!anchor || !anchor.parentElement || anchor.parentElement === document.body) return;

    const hostNode = document.createElement('div');
    hostNode.setAttribute('data-adsplus-v5', '');
    hostNode.style.cssText = 'display:block;width:100%;box-sizing:border-box;';
    const shadow = hostNode.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;display:block;width:100%;box-sizing:border-box}' +
      '.line{display:flex;align-items:center;gap:7px;box-sizing:border-box;margin:7px 0 10px;padding:5px 10px;border-left:2px solid #8b735b;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#76614d;background:rgba(150,125,96,.07)}' +
      '.tag{font-size:10px;letter-spacing:.5px;text-transform:uppercase;opacity:.72;white-space:nowrap}' +
      'a{color:inherit;font-weight:650;text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}' +
      'a:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
      '@media(prefers-color-scheme:dark){.line{color:#d8c7b5;border-left-color:#b89a7b;background:rgba(220,195,167,.07)}}';
    shadow.appendChild(style);
    const line = document.createElement('div');
    line.className = 'line';
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Sponsored';
    const link = document.createElement('a');
    link.href = result.click_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = result.ad.title;
    link.setAttribute('aria-label', 'Sponsored link: ' + result.ad.title);
    line.append(tag, link);
    shadow.appendChild(line);

    anchor.after(hostNode);
    activeHost = hostNode;
    activeServeId = result.serve_id;
    startDwell();
    log('sponsored link shown on', platform);
  }
  async function requestAd(user) {
    if (!effectiveEnabled || !user) return;
    try {
      const result = await sendMessage({
        type: 'ADSPLUS_SERVE_AD',
        platform,
        mobile: isMobile()
      });
      if (result && result.ad) showAd(result, user);
    } catch (error) {
      warn('serve failed:', error.message);
    }
  }
  function watchForNewUser(previousKey) {
    if (submitObserver) submitObserver.disconnect();
    submitObserver = new MutationObserver(() => {
      if (!effectiveEnabled) return;
      const current = lastUser();
      if (!current || keyOf(current) === previousKey) return;
      submitObserver.disconnect();
      submitObserver = null;
      requestAd(current);
    });
    submitObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      if (submitObserver) {
        submitObserver.disconnect();
        submitObserver = null;
      }
    }, 12000);
  }
  function handleSubmit() {
    if (effectiveEnabled) watchForNewUser(keyOf(lastUser()));
  }
  function bind() {
    if (!boundSend || !boundComposer) return;
    boundSend.addEventListener('click', handleSubmit, true);
    boundComposer.addEventListener('keydown', onComposerKey, true);
  }
  function onComposerKey(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) handleSubmit();
  }
  function unbind() {
    if (boundSend) boundSend.removeEventListener('click', handleSubmit, true);
    if (boundComposer) boundComposer.removeEventListener('keydown', onComposerKey, true);
    boundSend = null;
    boundComposer = null;
    if (submitObserver) submitObserver.disconnect();
    submitObserver = null;
  }
  function attach() {
    if (!effectiveEnabled) return;
    const send = q(selectors.send);
    const composer = q(selectors.composer);
    if (!send || !composer || (send === boundSend && composer === boundComposer)) return;
    unbind();
    boundSend = send;
    boundComposer = composer;
    bind();
    log('adapter attached for', platform);
  }
  function applyConfig(config) {
    const mobileAllowed = !isMobile() || !!(config && config.mobile_enabled);
    effectiveEnabled = localConfig.enabled !== false && localConfig.link !== false &&
      !!config && config.enabled === true && config.link_enabled === true &&
      !!config.platforms && config.platforms[platform] === true && mobileAllowed;
    if (!effectiveEnabled) {
      unbind();
      hideAd();
    } else {
      attach();
    }
  }
  async function refreshConfig() {
    try {
      const config = await sendMessage({ type: 'ADSPLUS_GET_CONFIG', refresh: true });
      applyConfig(config);
    } catch (error) {
      applyConfig(null);
      warn('config unavailable; ads remain disabled:', error.message);
    }
  }
  function loadLocalConfig() {
    chrome.storage.local.get([LOCAL_KEY], (stored) => {
      if (chrome.runtime.lastError) return applyConfig(null);
      const cfg = stored && stored[LOCAL_KEY] ? stored[LOCAL_KEY] : {};
      localConfig = { enabled: cfg.enabled !== false, link: cfg.link !== false };
      refreshConfig();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[LOCAL_KEY]) return;
    const cfg = changes[LOCAL_KEY].newValue || {};
    localConfig = { enabled: cfg.enabled !== false, link: cfg.link !== false };
    if (!localConfig.enabled || !localConfig.link) {
      effectiveEnabled = false;
      unbind();
      hideAd();
    } else {
      refreshConfig();
    }
  });

  attachObserver = new MutationObserver(() => attach());
  attachObserver.observe(document.body, { childList: true, subtree: true });
  loadLocalConfig();
  configTimer = setInterval(refreshConfig, 60000);

  window.addEventListener('pagehide', () => {
    if (configTimer) clearInterval(configTimer);
    if (attachObserver) attachObserver.disconnect();
    unbind();
    hideAd();
  }, { once: true });
})();
