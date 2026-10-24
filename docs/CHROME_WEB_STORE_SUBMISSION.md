# Chrome Web Store Submission Notes

## Extension Purpose

Video Theater lets users adjust video picture filters and remember up to three quick presets per domain so the same viewing correction is applied automatically next time.

## Canonical Behavior Summary

The extension runs a content script on pages with videos, applies CSS filters to `video` elements, and responds only when the user opens the toolbar popup, changes sliders, saves a quick setting, applies a saved setting, clears a setting, or changes the auto-apply option. Presets are stored in `chrome.storage.sync`; no data is sent to the developer or to third-party services. The popup's "Report a problem" link opens a GitHub new-issue page with the extension version, browser user agent, and current website hostname prefilled, only when the user clicks it.

## Permission Justification

### `storage`

Used to save user-created video filter presets and the auto-apply option in `chrome.storage.sync`.

### `activeTab`

Used by the popup after the user opens the extension so slider changes and preset actions can be sent to the active tab.

### `scripting`

Used only by the popup, right after the user opens it, to add the extension's own bundled content script (`src/state.js`, `src/content.js`) to the active tab when that tab was opened before the extension was installed or updated, or while site access is limited to "on click". It never injects remote code and never runs on tabs the user has not opened the popup on.

### Content script on `<all_urls>`

Required because videos can appear on many websites. The content script applies CSS filters to `video` elements, reads the current page hostname to find and save presets for that site, and counts video elements for the popup status. It does not inspect page text, inspect video contents, capture media, or modify form data.

## Data Use

The extension stores website hostnames, quick-setting slots, filter values, selected timestamps, updated timestamps, and the auto-apply option. Full page URLs are not stored (0.1.0 saved them; the 0.1.1 storage migration drops them). It does not transmit data externally on its own. The only user-initiated exception is the popup's "Report a problem" link, which opens a GitHub new-issue page with the extension version, browser user agent, and current website hostname prefilled in the page address.

## Paste-Ready Dashboard Answers

### Single Purpose

```text
Video Theater has one narrow purpose: it lets users adjust the visual filters of web page videos, including brightness, contrast, saturation, and warmth, and save up to three quick settings per domain. When the user returns to the same website, the extension can automatically reapply the last saved or selected video display setting for that domain.
```

### `activeTab` Permission

```text
The activeTab permission is used after the user opens the Video Theater toolbar popup, so the extension can send slider changes, apply preset actions, save actions, and clear actions to the current tab. The extension only acts on the active tab after user interaction and does not access inactive tabs.
```

### `scripting` Permission

```text
The scripting permission is used only after the user opens the Video Theater toolbar popup. If the current tab was opened before the extension was installed or updated, Chrome has not added the extension's content script to it yet, so the popup injects the extension's own bundled content script into that active tab. No remote code is executed, and the extension does not script tabs the user has not opened the popup on.
```

### `storage` Permission

```text
The storage permission is used to save user-created video filter presets and the auto-apply option in chrome.storage.sync. Saved data includes the website hostname, quick-setting slot, brightness, contrast, saturation, warmth values, selected timestamp, and updated timestamp. This data is used only to reapply the user's settings on matching domains.
```

### Website Access / Host Access

```text
Video Theater needs a content script on websites because videos can appear on many different sites. The content script is used only to apply CSS filters to video elements, read the current page hostname to find and save domain settings, and count video elements for display in the popup. The extension does not read page text, inspect video contents, capture media, modify form data, or send data to external servers.
```

### Remote Code

Select:

```text
No, I am not using remote code.
```

If a reason field is shown:

```text
Video Theater does not load or execute remote code. All executable JavaScript, HTML, CSS, and assets are packaged inside the extension ZIP submitted to the Chrome Web Store.
```

### Data Collection Categories

Recommended checked category:

- Web history

Reason: Video Theater stores the hostnames of websites where the user saves a preset in `chrome.storage.sync`, and the "Report a problem" link can prefill the current hostname into a GitHub issue page when the user clicks it. The data is not sent to a developer server, but it is handled by the extension and synced by Chrome storage.

Recommended unchecked categories:

- Personally identifiable information
- Health information
- Financial and payment information
- Authentication information
- Personal communications
- Location information
- Website content

Data-use explanation:

```text
The extension uses website hostnames only to match user-created video filter presets to the same domain. This data is stored in chrome.storage.sync and is not sold, used for advertising, used for creditworthiness, or sent to external servers by the extension. If the user clicks "Report a problem" in the popup, a GitHub new-issue page opens with the extension version, browser user agent, and current website hostname prefilled; this is user-initiated, and nothing is posted until the user reviews and submits the issue.
```

### Store URLs

Use these URLs unless the GitHub Pages custom domain is changed:

```text
Homepage URL: https://www.dowen.idv.tw/video_theater/
Support URL: https://www.dowen.idv.tw/video_theater/support.html
Privacy policy URL: https://www.dowen.idv.tw/video_theater/privacy.html
```

## Localization

Included locales:

- English (`en`)
- Traditional Chinese (`zh_TW`)
- Simplified Chinese (`zh_CN`)
- Japanese (`ja`)
- Korean (`ko`)

## Manual Store Checklist

- Confirm generated icons exist in `icons/`.
- Prepare at least one 1280x800 or 640x400 screenshot for each localized listing that needs localized screenshots.
- Prepare one global 440x280 small promotional image; Chrome Web Store promo tiles are not locale-specific.
- Run syntax and locale validation.
- Package with `scripts/package.ps1`.
- Upload the generated ZIP from `dist/`.
- Use the copy in `docs/STORE_LISTING.md`.
- Use `https://www.dowen.idv.tw/video_theater/` as the homepage URL.
- Use `https://www.dowen.idv.tw/video_theater/support.html` as the support URL.
- Use `https://www.dowen.idv.tw/video_theater/privacy.html` as the privacy policy URL.
