'use strict';
var CONFIG_KEY = "adsplus_cfg";
var enabled = document.getElementById("enabled");

chrome.storage.local.get([CONFIG_KEY], function (stored) {
  var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
  enabled.checked = config.enabled !== false;
});

enabled.addEventListener("change", function () {
  chrome.storage.local.set({ adsplus_cfg: { enabled: enabled.checked } });
});

document.getElementById("opts").addEventListener("click", function () {
  chrome.runtime.openOptionsPage();
});
