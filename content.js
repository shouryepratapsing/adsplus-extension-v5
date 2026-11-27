/* Ads+ Extension V5 — ChatGPT, Claude, and Gemini. */
(function () {
  "use strict";

  var HOST = location.hostname;
  var SITE = /(^|\.)chatgpt\.com$/.test(HOST) ? "chatgpt"
    : /(^|\.)claude\.ai$/.test(HOST) ? "claude"
    : /(^|\.)gemini\.google\.com$/.test(HOST) ? "gemini" : null;
  if (!SITE) return;

  function log() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift("[Ads+ V5]");
    console.info.apply(console, a);
  }
  function warn() {
    var a = Array.prototype.slice.call(arguments);
    a.unshift("[Ads+ V5]");
    console.warn.apply(console, a);
  }

  /* Widening fallback: escape a narrow right-aligned message bubble. */
  function widen(el, ratio, maxLevels) {
    if (!el) return null;
    var current = el;
    var baseWidth = el.getBoundingClientRect().width || 1;
    for (var i = 0; i < (maxLevels || 6); i++) {
      var parent = current.parentElement;
      if (!parent || parent === document.body) return null;
      /* Never return a body child as anchor: after(anchor) would append to body. */
      if (parent.parentElement === document.body) return current;
      if (parent.getBoundingClientRect().width >= baseWidth * (ratio || 1.25)) return parent;
      current = parent;
    }
    return current && current.parentElement !== document.body ? current : null;
  }

  function safeAnchor(anchor, userEl) {
    if (!anchor || anchor === document.body || anchor === document.documentElement) return null;
    if (anchor.parentElement !== document.body) return anchor;
    var fallback = widen(userEl || anchor, 1.25, 6);
    if (fallback && fallback.parentElement && fallback.parentElement !== document.body) return fallback;
    return null;
  }

  var A = {
    chatgpt: {
      send: '[data-testid="send-button"], button[data-composer-submit], form button[type="submit"][aria-label="Send"]',
      composer: "#prompt-textarea, [data-mobile-composer-prompt], [data-composer-markdown]",
      user: '[data-message-author-role="user"], [data-user-message-bubble]',
      hostAd: '[data-testid="sponsored-result"], .ad-container',
      detect: "snapshot",
      anchorFor: function (el) {
        var unit = el.closest && el.closest('[data-chatgpt-search-unit-key]');
        if (unit && unit.parentElement) return unit.parentElement;
        return widen(el, 1.25, 6);
      },
      key: function (el) {
        return el.getAttribute("data-message-id") ||
          (el.closest && el.closest("li[id]") ? el.closest("li[id]").id : null) || el;
      }
    },
    claude: {
      send: 'button[aria-label="Send message"]',
      composer: '[data-testid="chat-input"]',
      user: '[data-testid="user-message"], [data-cds="UserMessage"], [data-user-message-bubble]',
      hostAd: "",
      detect: "diff",
      settleMs: 700,
      corroborateMs: 1000,
      anchorFor: function (el) {
        var message = el.closest && el.closest('[data-cds="UserMessage"]');
        if (message && message.parentElement) return message.parentElement;
        var bubble = el.closest && el.closest("[data-user-message-bubble]");
        if (bubble && bubble.parentElement) return bubble.parentElement;
        return widen(el, 1.25, 6);
      },
      key: function (el) { return el; }
    },
    gemini: {
      send: 'button[aria-label="Send message"]',
      composer: "rich-textarea [contenteditable]",
      user: "user-query",
      hostAd: "shopping-list, [data-ad-slot]",
      detect: "snapshot",
      rebuildWatch: true,
      anchorFor: function (el) { return el; },
      key: function (el) { return el; }
    }
  }[SITE];

  var cfg = { enabled: true };
  var boundBtn = null, boundComposer = null, onSend = null, onKey = null;
  var preKey = null, submitAt = 0;
  var lastSeenEl = null, lastSeenText = null, settling = true, settleTimer = null;
  var pendingEl = null, pendingAt = 0;
  var hostEl = null, rootEl = null;
  var activeUserEl = null;
  var lastRequestedUserKey = null;
  var activeServeId = null, impressionTimer = null, impressionElapsed = 0;
  var impressionLastAt = 0, impressionPending = false, impressionSent = false;
  var watchUser = null, watchKeep = null, watchAttach = null, watchDiff = null;

  function q(selector) {
    try { return selector ? document.querySelector(selector) : null; } catch (e) { return null; }
  }
  function qa(selector) {
    try { return selector ? document.querySelectorAll(selector) : []; } catch (e) { return []; }
  }
  function lastUser() {
    var list = qa(A.user);
    return list.length ? list[list.length - 1] : null;
  }
  function keyOf(el) {
    try { return el ? A.key(el) : null; } catch (e) { return el; }
  }
  function armSettle(ms) {
    if (settleTimer) clearTimeout(settleTimer);
    settling = true;
    settleTimer = setTimeout(function () { settling = false; settleTimer = null; }, ms || A.settleMs || 700);
  }
  var CSS = ""
    + ":host{all:initial}"
    + ".adline{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;"
    + "margin:8px 0 4px;padding:3px 0;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;"
    + "font-size:13px;line-height:1.4;color:#5b514a}"
    + ".sponsor{flex-shrink:0;font-size:10px;font-weight:700;letter-spacing:.65px;"
    + "text-transform:uppercase;color:#8a817a}"
    + ".sep{color:#a39a93}"
    + ".adline a{color:#6f4e37;text-decoration:none;font-weight:650;min-width:0;overflow-wrap:anywhere}"
    + ".adline a:hover{text-decoration:underline}"
    + "@media(prefers-color-scheme:dark){.adline{color:#e5e4e2}.sponsor{color:#aaa19a}"
    + ".sep{color:#827870}.adline a{color:#e5e4e2}}";

  function sendBackgroundMessage(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response && response.error || "background_unavailable"));
        resolve(response.data);
      });
    });
  }

  function randomIdempotencyKey() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function stopImpressionTracking() {
    if (impressionTimer) clearInterval(impressionTimer);
    impressionTimer = null;
    impressionElapsed = 0;
    impressionLastAt = 0;
  }

  function recordVisibleImpression() {
    if (!activeServeId || impressionSent || impressionPending) return;
    impressionPending = true;
    var serveId = activeServeId;

    sendBackgroundMessage({
      type: "ADSPLUS_RECORD_IMPRESSION",
      payload: {
        serve_id: serveId,
        dwell_ms: 5000,
        idempotency_key: randomIdempotencyKey()
      }
    }).then(function (result) {
      impressionSent = true;
      log("impression recorded", result && result.already ? "(already)" : "");
    }).catch(function (error) {
      warn("impression recording failed:", error.message);
    }).then(function () {
      impressionPending = false;
    });
  }

  function startImpressionTracking() {
    stopImpressionTracking();
    if (!activeServeId || !hostEl) return;

    impressionLastAt = Date.now();
    impressionTimer = setInterval(function () {
      if (!hostEl || !hostEl.isConnected) {
        stopImpressionTracking();
        return;
      }

      var now = Date.now();
      var rect = hostEl.getBoundingClientRect();
      var visible = document.visibilityState === "visible" &&
        rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth;

      if (visible) {
        var delta = Math.max(0, now - impressionLastAt);
        impressionElapsed += delta;
      }
      impressionLastAt = now;

      if (impressionElapsed >= 5000) {
        if (impressionTimer) clearInterval(impressionTimer);
        impressionTimer = null;
        recordVisibleImpression();
      }
    }, 250);
  }

  function hideCard(silent) {
    stopImpressionTracking();
    activeServeId = null;
    impressionPending = false;
    impressionSent = false;
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null;
    rootEl = null;
    activeUserEl = null;
    if (!silent) log("sponsored line hidden");
  }

  function ensureWidth() {
    if (!hostEl || !hostEl.parentElement) return;
    var container = hostEl.parentElement;
    var outer = container.parentElement;
    if (!outer || container === document.body || outer === document.body || outer === document.documentElement) return;
    var hostWidth = hostEl.getBoundingClientRect().width;
    var outerWidth = outer.getBoundingClientRect().width;
    if (outerWidth > 0 && hostWidth > 0 && hostWidth < outerWidth * 0.8) {
      /* Promote one level without ever appending to body outside sticky mode. */
      container.after(hostEl);
    }
  }

  function showCard(ad, userEl, serveId) {
    if (!cfg.enabled || !ad || !serveId || !ad.url || !ad.text) return;
    hideCard(true);
    activeServeId = serveId;

    hostEl = document.createElement("div");
    hostEl.setAttribute("data-adsplus-v5", "");
    hostEl.style.display = "block";
    hostEl.style.width = "100%";
    hostEl.style.boxSizing = "border-box";

    rootEl = hostEl.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = CSS;
    rootEl.appendChild(style);

    var line = document.createElement("div");
    line.className = "adline";

    var sponsor = document.createElement("span");
    sponsor.className = "sponsor";
    sponsor.textContent = "Ads+ · Sponsored";
    line.appendChild(sponsor);

    var separator = document.createElement("span");
    separator.className = "sep";
    separator.textContent = "·";
    line.appendChild(separator);

    var link = document.createElement("a");
    link.href = ad.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = ad.text.slice(0, 80);
    line.appendChild(link);
    rootEl.appendChild(line);

    activeUserEl = userEl || lastUser();
    var anchor = safeAnchor(A.anchorFor(activeUserEl || null), activeUserEl);
    if (anchor && anchor.parentElement && anchor.parentElement !== document.body) {
      anchor.after(hostEl);
      ensureWidth();
      setTimeout(ensureWidth, 60);
      setTimeout(ensureWidth, 300);
      startKeeper();
      startImpressionTracking();
      log("Sponsored link shown on " + SITE);
    } else {
      hideCard(true);
    }
  }

  function anchorNow(el) {
    if (!cfg.enabled) return;
    var requestKey = keyOf(el);
    if (requestKey === lastRequestedUserKey) return;
    lastRequestedUserKey = requestKey;
    preKey = requestKey;

    var mobile = window.innerWidth <= 768 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

    sendBackgroundMessage({
      type: "ADSPLUS_SERVE_AD",
      platform: SITE,
      mobile: mobile
    }).then(function (result) {
      if (requestKey !== lastRequestedUserKey) return;
      if (!result || !result.ad || !result.serve_id || !result.click_url) return;

      var userEl = el && document.contains(el) ? el : lastUser();
      if (!userEl) return;

      showCard({
        id: result.ad.id,
        sponsor: "Sponsored",
        text: result.ad.title,
        desc: result.ad.body,
        url: result.click_url,
        logo: "adsplus-logo.svg"
      }, userEl, result.serve_id);
    }).catch(function (error) {
      warn("campaign request failed; no fallback ad shown:", error.message);
    });
  }

  /* Claude: wait for the newly submitted trailing user message to settle. */
  function detectTick() {
    if (A.detect !== "diff") return;
    var el = lastUser();
    if (!el) return;
    var txt = el.textContent;
    if (el === lastSeenEl && txt === lastSeenText) return;
    if (settling) {
      lastSeenEl = el; lastSeenText = txt; armSettle();
      return;
    }
    var prior = lastSeenEl;
    lastSeenEl = el; lastSeenText = txt;
    if (prior && !document.contains(prior)) { armSettle(); return; }
    if (!prior && Date.now() - submitAt >= (A.corroborateMs || 1000)) {
      pendingEl = el; pendingAt = Date.now(); armSettle();
      return;
    }
    pendingEl = null;
    anchorNow(el);
  }

  function handleSubmit() {
    if (!cfg.enabled) return;
    log("submit detected");
    submitAt = Date.now();
    if (A.detect === "diff") {
      var pending = pendingEl;
      pendingEl = null;
      if (pending && Date.now() - pendingAt < (A.corroborateMs || 1000) && pending === lastUser()) anchorNow(pending);
      return;
    }
    preKey = keyOf(lastUser());
    watchForUser();
  }

  function watchForUser() {
    if (watchUser) watchUser.disconnect();
    watchUser = new MutationObserver(function () {
      var el = lastUser();
      if (!el || keyOf(el) === preKey) return;
      watchUser.disconnect();
      watchUser = null;
      anchorNow(el);
    });
    watchUser.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      if (watchUser) { warn("no new user message detected within 12 seconds"); }
    }, 12000);
  }

  function startKeeper() {
    if (watchKeep) watchKeep.disconnect();
    watchKeep = new MutationObserver(function () {
      if (!hostEl) return;
      /* Do not fight the width-promote step. Re-anchor only if the site rebuilt
         or removed the active user-message node/card during its SPA updates. */
      if (hostEl.isConnected && activeUserEl && document.contains(activeUserEl)) return;
      var el = lastUser();
      if (!el) return;
      activeUserEl = el;
      var anchor = safeAnchor(A.anchorFor(el), el);
      if (anchor && anchor.parentElement && anchor.parentElement !== document.body) {
        anchor.after(hostEl);
        ensureWidth();
        setTimeout(ensureWidth, 60);
        setTimeout(ensureWidth, 300);
      }
    });
    watchKeep.observe(document.body, { childList: true, subtree: true });
  }

  function bind() {
    onSend = handleSubmit;
    onKey = function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) handleSubmit();
    };
    boundBtn.addEventListener("click", onSend, true);
    boundComposer.addEventListener("keydown", onKey, true);
  }
  function unbind() {
    if (boundBtn && onSend) boundBtn.removeEventListener("click", onSend, true);
    if (boundComposer && onKey) boundComposer.removeEventListener("keydown", onKey, true);
    onSend = null;
    onKey = null;
  }
  function attach() {
    var button = q(A.send);
    var composer = q(A.composer);
    if (!button || !composer) return;
    if (button === boundBtn && composer === boundComposer) return;
    unbind();
    boundBtn = button;
    boundComposer = composer;
    bind();
    log("adapter attached for " + SITE);
  }

  try {
    chrome.storage.local.get(["adsplus_cfg"], function (stored) {
      cfg = Object.assign({}, cfg, stored && stored.adsplus_cfg ? stored.adsplus_cfg : {});
      attach();
      if (A.detect === "diff") {
        lastSeenEl = lastUser();
        lastSeenText = lastSeenEl ? lastSeenEl.textContent : null;
        armSettle();
      }
      log("loaded on " + SITE + " | detect=" + A.detect);
    });
  } catch (error) {
    attach();
  }

  try {
    chrome.storage.onChanged.addListener(function (changes) {
      if (!changes.adsplus_cfg) return;
      cfg = Object.assign({}, cfg, changes.adsplus_cfg.newValue || {});
      if (!cfg.enabled) hideCard(true);
    });
  } catch (error) {}

  watchAttach = new MutationObserver(attach);
  watchAttach.observe(document.body, { childList: true, subtree: true });
  if (A.detect === "diff") {
    watchDiff = new MutationObserver(detectTick);
    watchDiff.observe(document.body, { childList: true, characterData: true, subtree: true });
  }
})();
