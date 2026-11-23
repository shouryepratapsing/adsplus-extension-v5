# Ads+ V5.1 — staging integration package

This is a **staging-only** extension build. It is pinned to:

`https://adsplus-api-staging.onrender.com`

It is not a production release and must not be submitted to Chrome Web Store or AMO.

## What is wired

- Public runtime flags from `GET /v1/config`.
- Global kill switch plus ChatGPT, Claude, Gemini, mobile and link-format flags.
- Device registration and bearer-token storage through `POST /v1/devices/register`.
- Real campaign retrieval through `POST /v1/ads/serve`.
- Link-only sponsored text line (no creative image/video, no bottom/sticky placement).
- A verified impression is submitted only after at least five seconds of visible dwell using `POST /v1/ad-impressions`.
- Fail-closed behaviour: if config, API or device authentication is unavailable, no ad is shown.

## Load unpacked

1. Extract this ZIP to a folder.
2. Open the browser extension manager.
3. Enable Developer Mode and choose **Load unpacked**.
4. Select this folder.
5. Open ChatGPT, Claude or Gemini and submit a prompt. An ad appears only when staging has an eligible active campaign.
6. Check the extension popup for API/config status.

## Important

- A missing eligible campaign returns no ad; this package does not insert a local demo ad.
- Device ID, install secret and bearer token are stored in `chrome.storage.local` on that browser profile.
- Mobile support depends on the browser supporting Manifest V3 extensions and the host site's DOM selectors.
- This build is for staging review only. The source repository change must be reviewed and merged separately; this ZIP is not a store release.
- Before production use, change `API_BASE` and the manifest host permission in a separate reviewed production release, then deploy the production flags. Do not reuse this staging package as a store release.
