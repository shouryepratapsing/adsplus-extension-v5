var CONFIG_KEY = "adsplus_cfg";
var DEFAULT_ADS = [{
  id: "adsplus-home",
  sponsor: "Ads+",
  text: "Discover Ads+",
  desc: "Explore Ads+ at adsplusprof.me.",
  url: "https://adsplusprof.me/",
  logo: "adsplus-logo.svg"
}];

function setStatus(message, error) {
  var el = document.getElementById("st");
  el.textContent = message;
  el.style.color = error ? "#f87171" : "#10b981";
}
function loadConfig() {
  chrome.storage.local.get([CONFIG_KEY], function (stored) {
    var config = stored && stored[CONFIG_KEY] ? stored[CONFIG_KEY] : {};
    document.getElementById("enabled").checked = config.enabled !== false;
    document.getElementById("link").checked = config.link !== false;
    document.getElementById("video").checked = !!config.video;
    document.getElementById("sticky").checked = !!config.sticky;
    var ads = Array.isArray(config.ads) ? config.ads : DEFAULT_ADS;
    document.getElementById("ads").value = JSON.stringify(ads, null, 2);
  });
}
document.getElementById("save").addEventListener("click", function () {
  var ads;
  try {
    ads = JSON.parse(document.getElementById("ads").value || "[]");
    if (!Array.isArray(ads)) throw new Error("Ads config must be a JSON array.");
    if (ads.some(function (ad) { return !ad || typeof ad !== "object" || Array.isArray(ad); })) {
      throw new Error("Each ad must be a JSON object.");
    }
  } catch (error) {
    setStatus("Invalid JSON: " + error.message, true);
    return;
  }
  var config = {
    enabled: document.getElementById("enabled").checked,
    link: document.getElementById("link").checked,
    video: document.getElementById("video").checked,
    sticky: document.getElementById("sticky").checked,
    ads: ads
  };
  chrome.storage.local.set({ adsplus_cfg: config }, function () {
    setStatus(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Saved.", !!chrome.runtime.lastError);
  });
});
document.getElementById("reset").addEventListener("click", function () {
  document.getElementById("ads").value = JSON.stringify(DEFAULT_ADS, null, 2);
  document.getElementById("enabled").checked = true;
  document.getElementById("link").checked = true;
  document.getElementById("video").checked = false;
  document.getElementById("sticky").checked = false;
  setStatus("Reset staged. Press Save settings to apply.");
});
loadConfig();
