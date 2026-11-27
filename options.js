var CONFIG_KEY = "adsplus_cfg";
var controls = ["enabled", "link", "video", "sticky"];
function setStatus(message, error) {
  var el = document.getElementById("st");
  if (!el) return;
  el.textContent = message;
  el.style.color = error ? "#f87171" : "#10b981";
}
function loadConfig() {
  chrome.storage.local.get([CONFIG_KEY], function (stored) {
    var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    controls.forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.checked = id === "enabled" || id === "link" ? config[id] !== false : !!config[id];
    });
  });
}
document.getElementById("save").addEventListener("click", function () {
  chrome.storage.local.get([CONFIG_KEY], function (stored) {
    var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    controls.forEach(function (id) { config[id] = document.getElementById(id).checked; });
    // Campaign creative is API-managed; never persist or render local demo ads.
    delete config.ads;
    chrome.storage.local.set({ adsplus_cfg: config }, function () {
      setStatus(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Saved. Ads are served by the Ads+ API.", !!chrome.runtime.lastError);
    });
  });
});
loadConfig();
