importScripts("state.js");

// Older versions kept every preset in one sync item, which overflows the 8 KB per-item quota.
// Split it up once after an update; a fresh install writes nothing so synced settings win.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "update") {
    globalThis.VideoTheaterStore.migrateLegacyState().catch(() => {});
  }
});
