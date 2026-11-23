const KEY = 'adsplus_cfg';
const enabled = document.getElementById('enabled');
const api = document.getElementById('api');
const platforms = document.getElementById('platforms');
const saved = document.getElementById('saved');

function loadLocal() {
  chrome.storage.local.get([KEY], (stored) => {
    const cfg = stored && stored[KEY] ? stored[KEY] : {};
    enabled.checked = cfg.enabled !== false;
  });
}

function showRemote() {
  api.textContent = 'Checking staging API…';
  chrome.runtime.sendMessage({ type: 'ADSPLUS_GET_CONFIG', refresh: true }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      api.textContent = 'Staging API unavailable. Ads are fail-closed.';
      api.className = 'status off';
      platforms.textContent = '';
      return;
    }
    const cfg = response.data;
    api.textContent = cfg.enabled ? 'Global server flag: ON' : 'Global server flag: OFF';
    api.className = 'status ' + (cfg.enabled ? 'on' : 'off');
    platforms.textContent = 'ChatGPT: ' + (cfg.platforms.chatgpt ? 'ON' : 'OFF') +
      ' · Claude: ' + (cfg.platforms.claude ? 'ON' : 'OFF') +
      ' · Gemini: ' + (cfg.platforms.gemini ? 'ON' : 'OFF') +
      ' · Mobile: ' + (cfg.mobile_enabled ? 'ON' : 'OFF') +
      ' · Ad type: ' + cfg.ad_type;
  });
}

enabled.addEventListener('change', () => {
  chrome.storage.local.set({ [KEY]: { enabled: enabled.checked, link: true } }, () => {
    saved.textContent = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Saved';
  });
});

document.getElementById('refresh').addEventListener('click', showRemote);
loadLocal();
showRemote();
