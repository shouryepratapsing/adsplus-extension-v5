'use strict';
var CONFIG_KEY = "adsplus_cfg";

function setStatus(message, error) {
  var el = document.getElementById("st");
  el.textContent = message;
  el.style.color = error ? "#f87171" : "#10b981";
}
function loadConfig() {
  chrome.storage.local.get([CONFIG_KEY], function (stored) {
    var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    document.getElementById("enabled").checked = config.enabled !== false;
  });
}
document.getElementById("save").addEventListener("click", function () {
  var config = { enabled: document.getElementById("enabled").checked };
  chrome.storage.local.set({ adsplus_cfg: config }, function () {
    setStatus(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Saved.", !!chrome.runtime.lastError);
  });
});
document.getElementById("reset").addEventListener("click", function () {
  document.getElementById("enabled").checked = true;
  setStatus("Extension enabled. Press Save settings to apply.");
});
loadConfig();
