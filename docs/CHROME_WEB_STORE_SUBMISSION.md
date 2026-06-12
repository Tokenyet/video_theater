# Chrome Web Store Submission Notes

## Extension Purpose

Video Theater lets users adjust video picture filters and remember up to three quick presets per domain so the same viewing correction is applied automatically next time.

## Canonical Behavior Summary

The extension runs a content script on pages with videos, applies CSS filters to `video` elements, and responds only when the user opens the toolbar popup, changes sliders, saves a quick setting, applies a saved setting, clears a setting, or changes the auto-apply option. Presets are stored in `chrome.storage.sync`; no data is sent to the developer or to third-party services.

## Permission Justification

### `storage`

Used to save user-created video filter presets and the auto-apply option in `chrome.storage.sync`.

### `activeTab`

Used by the popup after the user opens the extension so slider changes and preset actions can be sent to the active tab.

### Content script on `<all_urls>`

Required because videos can appear on many websites. The content script applies CSS filters to `video` elements, reads the current page hostname and URL when the user saves a preset, and counts video elements for the popup status. It does not inspect page text, inspect video contents, capture media, or modify form data.

## Data Use

The extension stores saved page URLs, hostnames/domain labels, quick-setting slots, filter values, selected timestamps, updated timestamps, and the auto-apply option. It does not transmit data externally.

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
- Use `https://tokenyet.github.io/video_theater/` as the homepage URL.
- Use `https://tokenyet.github.io/video_theater/support.html` as the support URL.
- Use `https://tokenyet.github.io/video_theater/privacy.html` as the privacy policy URL.
