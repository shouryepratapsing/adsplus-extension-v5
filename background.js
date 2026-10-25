/* Ads+ V5 service worker. The default campaign is Ads+ only; no third-party demo ads. */
var ADSPLUS_DEFAULT_ADS = [
  {
    id: "adsplus-home",
    sponsor: "Ads+",
    text: "Discover Ads+",
    desc: "Explore Ads+ at adsplusprof.me.",
    url: "https://adsplusprof.me/",
    logo: "adsplus-logo.svg"
  }
];

var ADSPLUS_DEFAULT_CONFIG = {
  enabled: true,
  link: true,
  video: false,
  sticky: false,
  ads: ADSPLUS_DEFAULT_ADS
};

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(["adsplus_cfg"], function (stored) {
    var existing = stored && stored.adsplus_cfg ? stored.adsplus_cfg : {};
    /* Keep the user's display toggles, but start V5 with the Ads+ campaign. */
    var nextConfig = Object.assign({}, ADSPLUS_DEFAULT_CONFIG, existing, {
      ads: ADSPLUS_DEFAULT_ADS
    });
    chrome.storage.local.set({ adsplus_cfg: nextConfig });
  });
});
