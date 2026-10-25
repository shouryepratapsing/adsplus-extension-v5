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

  var ADSPLUS_DEFAULT_ADS = [{
    id: "adsplus-home",
    sponsor: "Ads+",
    text: "Discover Ads+",
    desc: "Explore Ads+ at adsplusprof.me.",
    url: "https://adsplusprof.me/",
    logo: "adsplus-logo.svg"
  }];

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

  var cfg = { enabled: true, link: true, video: false, sticky: false, ads: ADSPLUS_DEFAULT_ADS };
  var cursor = 0;
  var boundBtn = null, boundComposer = null, onSend = null, onKey = null;
  var preKey = null, submitAt = 0;
  var lastSeenEl = null, lastSeenText = null, settling = true, settleTimer = null;
  var pendingEl = null, pendingAt = 0;
  var hostEl = null, rootEl = null, videoEl = null, dismissEl = null, unlockAt = 0, ticker = null;
  var activeUserEl = null;
  var watchUser = null, watchKeep = null, watchAttach = null, watchDiff = null, styleEl = null;

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
  function getAds() {
    var ads = Array.isArray(cfg.ads) ? cfg.ads.filter(function (ad) {
      return ad && typeof ad === "object" && (ad.text || ad.sponsor) && ad.url;
    }) : [];
    return ads.length ? ads : ADSPLUS_DEFAULT_ADS;
  }
  function pickAd() {
    var ads = getAds();
    return ads[cursor++ % ads.length] || ADSPLUS_DEFAULT_ADS[0];
  }
  function logoSource(ad) {
    var logo = ad && typeof ad.logo === "string" ? ad.logo.trim() : "";
    if (!logo) return chrome.runtime.getURL("adsplus-logo.svg");
    if (/^https:\/\//i.test(logo)) return logo;
    return chrome.runtime.getURL(logo.replace(/^\/+/, ""));
  }

  var CSS = ""
    + ":host{all:initial}"
    + ".card{display:block;width:100%;box-sizing:border-box;margin:10px 0;padding:11px 14px;"
    + "background:#E6E0F0;border-top:1px solid #6F4E37;border-bottom:1px solid #6F4E37;"
    + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}'
    + ".row{display:flex;align-items:flex-start;gap:11px}"
    + ".brand{flex-shrink:0;width:30px;height:30px;object-fit:contain;display:block;margin-top:1px}"
    + ".text{flex:1;min-width:0;color:#6F4E37}"
    + ".sponsor{font-size:10px;letter-spacing:.8px;text-transform:uppercase;"
    + "color:rgba(111,78,55,.55);margin-bottom:2px}"
    + ".text a{color:#6F4E37;text-decoration:none;font-weight:650;font-size:15px;line-height:1.4}"
    + ".text a:hover{text-decoration:underline}"
    + ".headline{font-weight:650;font-size:15px;line-height:1.4;color:#6F4E37}"
    + ".desc{font-size:12.5px;color:rgba(111,78,55,.7);margin-top:3px;line-height:1.45}"
    + ".dismiss{flex-shrink:0;background:none;border:none;color:rgba(111,78,55,.5);cursor:pointer;"
    + "font-size:15px;line-height:1;padding:2px 4px;border-radius:6px;opacity:0;transition:opacity .12s}"
    + ".card:hover .dismiss,.dismiss:focus-visible{opacity:1}"
    + ".dismiss[disabled]{opacity:.45;cursor:default}"
    + ".video{margin:9px 0 2px 41px;border-radius:8px;overflow:hidden;max-width:430px;background:#E5E4E2}"
    + ".video video{display:block;width:100%;height:auto}"
    + ".video .ph{padding:24px 12px;text-align:center;font-size:11px;letter-spacing:.7px;color:#6F4E37;background:#E5E4E2}"
    + "@media(prefers-color-scheme:dark){"
    + ".card{background:#241C17}"
    + ".text{color:#E5E4E2}.text a{color:#E5E4E2}.headline{color:#E5E4E2}"
    + ".desc{color:rgba(229,228,226,.62)}.sponsor{color:rgba(229,228,226,.45)}"
    + ".dismiss{color:rgba(229,228,226,.5)}.video{background:#1a1512}}"
    + ":host(.sticky){position:fixed;left:0;right:0;bottom:0;z-index:2147483000}"
    + ":host(.sticky) .card{margin:0;border-top:none;box-shadow:0 -1px 14px rgba(111,78,55,.16)}";

  function hideCard(silent) {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (hostEl && hostEl.parentNode) hostEl.parentNode.removeChild(hostEl);
    hostEl = null; rootEl = null; videoEl = null; dismissEl = null; activeUserEl = null;
    if (!silent) log("card dismissed");
  }

  function ensureWidth() {
    if (!hostEl || cfg.sticky || !hostEl.parentElement) return;
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

  function showCard(ad, userEl) {
    if (!cfg.enabled || !ad) return;
    hideCard(true);
    hostEl = document.createElement("div");
    hostEl.setAttribute("data-adsplus-v5", "");
    hostEl.style.display = "block";
    hostEl.style.width = "100%";
    hostEl.style.boxSizing = "border-box";
    if (cfg.sticky) hostEl.className = "sticky";
    rootEl = hostEl.attachShadow({ mode: "closed" });

    var style = document.createElement("style");
    style.textContent = CSS;
    rootEl.appendChild(style);

    var card = document.createElement("div");
    card.className = "card";
    var row = document.createElement("div");
    row.className = "row";

    var logo = document.createElement("img");
    logo.className = "brand";
    logo.src = logoSource(ad);
    logo.alt = (ad.sponsor || "Ads+") + " logo";
    logo.decoding = "async";
    logo.addEventListener("error", function () {
      logo.src = chrome.runtime.getURL("adsplus-logo.svg");
    }, { once: true });
    row.appendChild(logo);

    var text = document.createElement("div");
    text.className = "text";
    var sponsor = document.createElement("div");
    sponsor.className = "sponsor";
    sponsor.textContent = ad.sponsor || "Ads+";
    text.appendChild(sponsor);

    if (cfg.link !== false) {
      var link = document.createElement("a");
      link.href = ad.url || "https://adsplusprof.me/";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = ad.text || "Discover Ads+";
      text.appendChild(link);
    } else {
      var headline = document.createElement("span");
      headline.className = "headline";
      headline.textContent = ad.text || "Discover Ads+";
      text.appendChild(headline);
    }
    if (ad.desc) {
      var desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = ad.desc;
      text.appendChild(desc);
    }
    row.appendChild(text);

    dismissEl = document.createElement("button");
    dismissEl.className = "dismiss";
    dismissEl.setAttribute("aria-label", "Dismiss ad");
    dismissEl.textContent = "×";
    dismissEl.addEventListener("click", function () { hideCard(); });
    row.appendChild(dismissEl);
    card.appendChild(row);

    if (cfg.video && ad.video) {
      var wrap = document.createElement("div");
      wrap.className = "video";
      videoEl = document.createElement("video");
      videoEl.src = ad.video;
      videoEl.muted = true;
      videoEl.loop = true;
      videoEl.autoplay = true;
      videoEl.setAttribute("playsinline", "");
      videoEl.addEventListener("error", function () {
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
        var placeholder = document.createElement("div");
        placeholder.className = "ph";
        placeholder.textContent = "AD VIDEO UNAVAILABLE";
        wrap.appendChild(placeholder);
      });
      wrap.appendChild(videoEl);
      card.appendChild(wrap);
      dismissEl.disabled = true;
      unlockAt = Date.now() + 5000;
      ticker = setInterval(function () {
        var left = Math.ceil((unlockAt - Date.now()) / 1000);
        if (!dismissEl) { clearInterval(ticker); ticker = null; return; }
        if (left > 0) dismissEl.textContent = left + "s";
        else {
          dismissEl.disabled = false;
          dismissEl.textContent = "×";
          clearInterval(ticker);
          ticker = null;
        }
      }, 250);
      var playPromise = videoEl.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    }

    rootEl.appendChild(card);
    activeUserEl = userEl || lastUser();
    if (cfg.sticky) {
      document.body.appendChild(hostEl);
    } else {
      var anchor = safeAnchor(A.anchorFor(activeUserEl || null), activeUserEl);
      if (anchor && anchor.parentElement && anchor.parentElement !== document.body) anchor.after(hostEl);
      ensureWidth();
      setTimeout(ensureWidth, 60);
      setTimeout(ensureWidth, 300);
      startKeeper();
    }
    log("Ads+ card shown on " + SITE);
  }

  function anchorNow(el) {
    if (!cfg.enabled) return;
    var ad = pickAd();
    if (!ad) { warn("no ad configured"); return; }
    preKey = keyOf(el);
    showCard(ad, el);
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
      if (!hostEl || cfg.sticky) return;
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

  function applyBlocking() {
    var shouldBlock = !!(cfg.enabled && cfg.sticky && A.hostAd);
    if (shouldBlock && !styleEl) {
      styleEl = document.createElement("style");
      styleEl.setAttribute("data-adsplus-v5-style", "");
      styleEl.textContent = A.hostAd.split(",").map(function (selector) {
        return selector.trim() + "{display:none !important}";
      }).join("\n");
      (document.head || document.documentElement).appendChild(styleEl);
    } else if (!shouldBlock && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  try {
    chrome.storage.local.get(["adsplus_cfg"], function (stored) {
      cfg = Object.assign({}, cfg, stored && stored.adsplus_cfg ? stored.adsplus_cfg : {});
      if (!Array.isArray(cfg.ads) || !cfg.ads.length) cfg.ads = ADSPLUS_DEFAULT_ADS;
      attach();
      applyBlocking();
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
      if (!Array.isArray(cfg.ads) || !cfg.ads.length) cfg.ads = ADSPLUS_DEFAULT_ADS;
      applyBlocking();
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
