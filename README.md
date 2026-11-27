# Ads+ Extension V5

Manifest V3 extension for ChatGPT, Claude, and Gemini.

## Display format
- One compact sponsored text link near the submitted prompt.
- No video ads, pinned bottom placements, image creatives, or local demo ads.
- The sponsored link is opened through the API's server-tracked /go/{serve_id} URL.
- The extension records an impression after at least five seconds of visible placement.

## Server integration (staging)
This repository build currently points to:
https://adsplus-api-staging.onrender.com

The extension:
- Reads platform, mobile, and link feature flags from GET /v1/config.
- Registers a persistent extension device with POST /v1/devices/register.
- Requests campaigns from POST /v1/ads/serve.
- Records impressions with POST /v1/ad-impressions.
- Shows no ad when the API is unavailable or no eligible campaign exists.

Local settings contain only an extension on/off switch. Platform and mobile eligibility remain server-controlled.

## Load unpacked
1. Extract the source ZIP into a folder.
2. Open the browser's extensions page and enable Developer Mode if available.
3. Select Load unpacked and choose the extracted folder.
4. Test separately on ChatGPT, Claude, and Gemini, including mobile layouts where the browser supports extensions.

This branch remains staging-only. Complete browser end-to-end testing before changing the API base URL or publishing to a store.
