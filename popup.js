var CONFIG_KEY = "adsplus_cfg";
var controls = ["enabled", "video", "sticky"];
chrome.storage.local.get([CONFIG_KEY], function (stored) {
  var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
  document.getElementById("enabled").checked = config.enabled !== false;
  document.getElementById("video").checked = !!config.video;
  document.getElementById("sticky").checked = !!config.sticky;
});
function savePopupSettings() {
  chrome.storage.local.get([CONFIG_KEY], function (stored) {
    var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    controls.forEach(function (id) {
      config[id] = document.getElementById(id).checked;
    });
    if (config.link === undefined) config.link = true;
    if (!Array.isArray(config.ads) || !config.ads.length) {
      config.ads = [{ id: "adsplus-home", sponsor: "Ads+", text: "Discover Ads+", desc: "Explore Ads+ at adsplusprof.me.", url: "https://adsplusprof.me/", logo: "adsplus-logo.svg" }];
    }
    chrome.storage.local.set({ adsplus_cfg: config });
  });
}
controls.forEach(function (id) {
  document.getElementById(id).addEventListener("change", savePopupSettings);
});
document.getElementById("opts").addEventListener("click", function () {
  chrome.runtime.openOptionsPage();
});
