# Video Theater Privacy Policy

Video Theater adjusts CSS filters on video elements in the current browser page. The extension does not collect analytics, does not transmit data to external services, and does not sell or share user data.

## Stored Data

The extension stores user-created presets in `chrome.storage.sync`:

- Saved page URL, hostname/domain label, and quick-setting slot selected by the user
- Brightness, contrast, saturation, and warmth values
- Last selected and last updated timestamps
- The auto-apply preference

This data is used only to reapply the user's chosen video settings on matching pages and to show saved presets in the options page. Matching is based on the hostname and quick-setting slot.

## Page Access

Video Theater runs a content script on web pages so it can apply CSS filters to video elements. The script reads the page hostname and URL when the user saves a preset, counts video elements for the popup status, and applies a CSS filter to `video` elements. It does not inspect page text, inspect video contents, capture media, or modify form data.

## Resetting Data

Users can remove individual quick settings from the popup, delete individual presets from the options page, or delete every saved preset from the options-page danger zone.

## Network

The extension does not contact any remote server.
