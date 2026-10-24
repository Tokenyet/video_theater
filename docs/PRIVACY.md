# Video Theater Privacy Policy

Video Theater adjusts CSS filters on video elements in the current browser page. The extension does not collect analytics and does not sell or share user data. It sends nothing to the developer or to third-party services, except the details a user chooses to send by clicking "Report a problem" (see below).

## Stored Data

The extension stores user-created presets in `chrome.storage.sync`:

- The website hostname and quick-setting slot selected by the user
- Brightness, contrast, saturation, and warmth values
- Last selected and last updated timestamps
- The auto-apply preference

Full page URLs are not stored. Earlier versions also saved the page URL; it is removed when stored presets are converted to the current format.

This data is used only to reapply the user's chosen video settings on matching pages and to show saved presets in the options page. Matching is based on the hostname and quick-setting slot. If browser sync is turned on, the browser syncs this data between the user's signed-in browsers; the developer has no access to it.

## Page Access

Video Theater runs a content script on web pages so it can apply CSS filters to video elements. The script reads the page hostname to find and save presets for that site, counts video elements for the popup status, and applies a CSS filter to `video` elements. Inside embedded frames, such as video players, it uses the hostname of the page that contains the frame, so the player follows that site's presets. It does not inspect page text, inspect video contents, capture media, or modify form data.

When the user opens the popup on a tab that was already open before the extension was installed or updated, the extension adds its own bundled content script to that tab. It never runs remote code.

## Reporting a Problem

The popup has a "Report a problem" link. Clicking it opens a new GitHub issue page on github.com, in a new tab, with the extension version, the browser's user agent string, and the current website hostname prefilled in the issue text. These details are part of the page address, so GitHub receives them when the page opens. Nothing is published until the user reviews and submits the issue, and the prefilled text can be edited or removed first. GitHub's privacy statement applies to that page. Nothing is sent if the link is not clicked.

## Resetting Data

Users can remove individual quick settings from the popup, delete individual presets from the options page, or delete every saved preset from the options-page danger zone.

## Network

The extension does not contact any remote server on its own. The only network requests it causes are the pages a user opens from the popup's "Report a problem" and "GitHub" links.
