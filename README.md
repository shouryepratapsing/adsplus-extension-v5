# Ads+ Extension V5

Manifest V3 browser extension for ChatGPT, Claude, and Gemini.

## Default ad
- Sponsor: Ads+
- Headline: Discover Ads+
- Link: https://adsplusprof.me/
- Transparent in-extension logo: `adsplus-logo.svg`

The default campaign is only the Ads+ ad. Settings are stored under `adsplus_cfg` and can be changed from the extension's full settings page.

## Load unpacked
1. Extract `extension v5.zip` into a folder.
2. Open your browser's extensions page and enable Developer Mode if available.
3. Select **Load unpacked** and choose the extracted `extension v5` folder.
4. Open ChatGPT, Claude, or Gemini and submit a prompt to test the sponsored card.

This extension uses page-specific DOM selectors. Because these websites update their interfaces regularly, selectors and exact card placement may need maintenance if a host site changes its markup.


## Live campaign API (staging)

The extension now requests campaigns from the Ads+ staging API:
`https://adsplus-api-staging.onrender.com`

- Reads platform and mobile feature flags from `GET /v1/config`.
- Registers one persistent extension device with `POST /v1/devices/register`.
- Requests sponsored campaigns from `POST /v1/ads/serve`.
- Opens the server-tracked `/go/{serve_id}` click URL.
- Records an impression only after the sponsored placement has remained visible for at least five seconds using `POST /v1/ad-impressions`.
- If the API is unavailable or no campaign is eligible, the extension shows no ad; it does not insert a local demo ad.

This repository build points to **staging only**. Do not treat it as a production release or submit it to a store before browser end-to-end testing.

## Download source

[Download the current main-branch source ZIP](https://github.com/shouryepratapsing/adsplus-extension-v5/archive/refs/heads/main.zip)
