# Chrome Web Store Submission Notes

## Extension Purpose

Video Theater lets users adjust video picture filters and remember up to three quick presets per domain so the same viewing correction is applied automatically next time.

## Permission Justification

### `storage`

Used to save user-created video filter presets and options in `chrome.storage.sync`.

### `activeTab`

Used by the popup to communicate with the current tab when the user changes sliders or saves a preset.

### Content script on `<all_urls>`

Required because videos can appear on many websites. The content script applies CSS filters to `video` elements and reads the current page domain only to match user-saved presets.

## Data Use

The extension stores domain labels, quick-setting slots, filter values, and timestamps for user-created presets. It does not transmit data externally.

## Localization

Included locales:

- English (`en`)
- Traditional Chinese (`zh_TW`)
- Simplified Chinese (`zh_CN`)
- Japanese (`ja`)
- Korean (`ko`)

## Manual Store Checklist

- Confirm generated icons exist in `icons/`.
- Run syntax and locale validation.
- Package with `scripts/package.ps1`.
- Upload the generated ZIP from `dist/`.
- Use the copy in `docs/STORE_LISTING.md`.
