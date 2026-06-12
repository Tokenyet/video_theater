# Video Theater

Video Theater is a Chrome/Vivaldi-compatible MV3 extension for adjusting video picture filters per site. It is built for cases where a video is too bright or too dark in the current environment and the same correction should be remembered next time.

## Features

- Adjust video brightness, contrast, saturation, and warmth from the extension popup.
- Save up to three quick filter presets for each domain.
- Quickly apply, overwrite, or clear a saved domain preset from the popup.
- Automatically apply the last saved or selected preset when matching pages open.
- Temporarily preview neutral sliders without changing saved presets.
- Manage saved presets from the options page.
- Localized extension UI for English, Traditional Chinese, Simplified Chinese, Japanese, and Korean.

## Usage

1. Load the extension folder from `chrome://extensions` with Developer mode enabled.
2. Open a page with a video.
3. Click the Video Theater toolbar icon and adjust the sliders.
4. Choose one of the three quick setting rows and press `Save` to store the current sliders for the domain.
5. Press a saved quick setting row to apply it immediately. The last saved or selected row is restored automatically next time.
6. Use `Preview default` to temporarily return the current tab to neutral values without deleting saved presets.
7. Use `Clear` on a quick setting row to remove only that saved preset.
8. Open `Manage presets` to delete individual presets or use the options-page danger zone to delete every saved preset.

## Privacy

Video Theater stores only user-created filter presets and the auto-apply option in `chrome.storage.sync`. Presets include the saved page URL, hostname/domain label, quick-setting slot number, filter values, selection time, and update time. The extension uses the hostname and slot to restore presets for matching pages. It does not collect analytics, contact remote servers, capture media, or read video contents.

## Development

Run syntax and locale checks before packaging:

```powershell
node --check src/content.js
node --check popup/popup.js
node --check options/options.js
node --check src/background.js
Get-ChildItem _locales -Recurse -Filter messages.json | ForEach-Object { Get-Content -Raw $_.FullName | ConvertFrom-Json > $null }
node scripts\smoke-test.mjs
```

Generate icons and a store-ready ZIP:

```powershell
.\scripts\generate-icons.ps1
.\scripts\package.ps1
```

Chrome Web Store release drafts are in `docs/STORE_LISTING.md`, `docs/CHROME_WEB_STORE_SUBMISSION.md`, and `docs/PRIVACY.md`.

Published pages:

- Homepage: https://www.dowen.idv.tw/video_theater/
- Support: https://www.dowen.idv.tw/video_theater/support.html
- Privacy policy: https://www.dowen.idv.tw/video_theater/privacy.html
