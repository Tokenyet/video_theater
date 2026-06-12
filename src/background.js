const STORAGE_KEY = "videoTheaterState";

const DEFAULT_STATE = {
  version: 2,
  autoApply: true,
  defaultFilters: {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0
  },
  presets: {}
};

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_STATE });
  }
});
