const CONFIG_KEY = 'adsplus_cfg';
const enabled = document.getElementById('enabled');
const status = document.getElementById('status');

chrome.storage.local.get([CONFIG_KEY], (stored) => {
  const config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
  enabled.checked = config.enabled !== false;
});

enabled.addEventListener('change', () => {
  chrome.storage.local.get([CONFIG_KEY], (stored) => {
    const config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    chrome.storage.local.set({ [CONFIG_KEY]: { enabled: enabled.checked, link: true } });
  });
});

chrome.runtime.sendMessage({ type: 'ADSPLUS_GET_CONFIG', refresh: true }, (response) => {
  if (chrome.runtime.lastError || !response || !response.ok) {
    status.textContent = 'Staging API unavailable. Ads are fail-closed.';
    return;
  }
  const cfg = response.data;
  status.textContent = cfg.enabled
    ? 'Staging API connected · ChatGPT, Claude, Gemini: ' +
      [cfg.platforms.chatgpt, cfg.platforms.claude, cfg.platforms.gemini].filter(Boolean).length + '/3 enabled'
    : 'Ads are disabled by the server feature flag.';
});

document.getElementById('opts').addEventListener('click', () => chrome.runtime.openOptionsPage());
