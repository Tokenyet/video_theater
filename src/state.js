// Shared state + storage layer for the content script, options page, and service worker.
// Loaded as a classic script, so it may be evaluated more than once in the same world.
(() => {
  if (globalThis.VideoTheaterStore) {
    return;
  }

  const STORAGE_KEY = "videoTheaterState";
  const PRESET_KEY_PREFIX = "videoTheaterPreset:";
  const STATE_VERSION = 3;
  const MAX_PRESETS = 300;
  const MAX_DOMAIN_PRESETS = 3;
  // chrome.storage.sync allows 102,400 bytes in total; keep headroom for settings.
  const PRESET_BYTES_BUDGET = 90000;

  const FILTER_LIMITS = Object.freeze({
    brightness: [0, 250],
    contrast: [25, 250],
    saturation: [0, 250],
    warmth: [0, 40]
  });

  const DEFAULT_FILTERS = Object.freeze({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0
  });

  const DEFAULT_STATE = Object.freeze({
    version: STATE_VERSION,
    autoApply: true,
    defaultFilters: DEFAULT_FILTERS,
    presets: Object.freeze({})
  });

  // Storage layout (v3): settings live under STORAGE_KEY and every preset has its own
  // `videoTheaterPreset:<hostname>:<slot>` item. v1/v2 kept every preset inside
  // STORAGE_KEY, which hit the 8 KB per-item sync quota after roughly 20 presets.
  async function loadState() {
    const items = await chrome.storage.sync.get(null);
    return normalizeState(fromStorageItems(items || {}));
  }

  async function saveState(nextState) {
    const normalized = normalizeState(nextState);
    const nextItems = toStorageItems(normalized);
    const existing = (await chrome.storage.sync.get(null)) || {};

    const staleKeys = Object.keys(existing)
      .filter((key) => key.startsWith(PRESET_KEY_PREFIX) && !(key in nextItems));
    if (staleKeys.length > 0) {
      await chrome.storage.sync.remove(staleKeys);
    }

    const changedItems = Object.fromEntries(
      Object.entries(nextItems)
        .filter(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value))
    );
    if (Object.keys(changedItems).length > 0) {
      await chrome.storage.sync.set(changedItems);
    }

    return normalized;
  }

  // Moves presets out of a legacy single-item state. Does nothing when there is no legacy data,
  // so a fresh install never writes defaults over settings that sync has not delivered yet.
  async function migrateLegacyState() {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const settings = result?.[STORAGE_KEY];
    if (!isObject(settings) || !isObject(settings.presets)) {
      return false;
    }

    await saveState(await loadState());
    return true;
  }

  function isStorageKey(key) {
    return key === STORAGE_KEY || key.startsWith(PRESET_KEY_PREFIX);
  }

  function fromStorageItems(items) {
    const settings = isObject(items[STORAGE_KEY]) ? items[STORAGE_KEY] : {};
    const presets = { ...(isObject(settings.presets) ? settings.presets : {}) };

    for (const [key, value] of Object.entries(items)) {
      const parsed = parseStoredPresetKey(key);
      if (!parsed || !isObject(value)) {
        continue;
      }

      const stateKey = buildDomainSlotKey(parsed.hostname, parsed.slot);
      const legacy = presets[stateKey];
      if (!isObject(legacy) || (Number(value.updatedAt) || 0) >= (Number(legacy.updatedAt) || 0)) {
        presets[stateKey] = { ...value, hostname: parsed.hostname, slot: parsed.slot };
      }
    }

    return { ...settings, presets };
  }

  function toStorageItems(state) {
    const items = {
      [STORAGE_KEY]: {
        version: STATE_VERSION,
        autoApply: state.autoApply,
        defaultFilters: state.defaultFilters
      }
    };

    for (const preset of Object.values(state.presets)) {
      items[buildStoredPresetKey(preset.hostname, preset.slot)] = toStoredPreset(preset);
    }

    return items;
  }

  function toStoredPreset(preset) {
    return {
      filters: preset.filters,
      updatedAt: preset.updatedAt,
      selectedAt: preset.selectedAt
    };
  }

  function buildStoredPresetKey(hostname, slot) {
    return `${PRESET_KEY_PREFIX}${normalizeHostname(hostname)}:${slot}`;
  }

  function parseStoredPresetKey(key) {
    if (!key.startsWith(PRESET_KEY_PREFIX)) {
      return null;
    }

    const match = key.slice(PRESET_KEY_PREFIX.length).match(/^(.+):([1-3])$/);
    return match ? { hostname: normalizeHostname(match[1]), slot: Number(match[2]) } : null;
  }

  function normalizeState(value) {
    const source = isObject(value) ? value : {};
    const presets = isObject(source.presets) ? source.presets : {};
    const groupedPresets = new Map();
    const candidates = [];

    for (const [key, preset] of Object.entries(presets)) {
      if (!isObject(preset)) {
        continue;
      }

      const parsed = parsePresetKey(key, preset);
      if (!parsed) {
        continue;
      }

      candidates.push({
        ...parsed,
        preset,
        updatedAt: Number(preset.updatedAt) || 0
      });
    }

    candidates
      .sort((left, right) => left.priority - right.priority || right.updatedAt - left.updatedAt)
      .forEach((candidate) => {
        const hostname = normalizeHostname(candidate.hostname);
        if (!hostname) {
          return;
        }

        const slots = groupedPresets.get(hostname) || {};
        const slot = candidate.slot || findOpenSlot(slots);
        if (!slot || slots[slot]) {
          groupedPresets.set(hostname, slots);
          return;
        }

        slots[slot] = normalizePreset(candidate.preset, hostname, slot);
        groupedPresets.set(hostname, slots);
      });

    const normalizedPresets = {};
    for (const [hostname, slots] of groupedPresets.entries()) {
      for (const slot of Object.keys(slots).map(Number).sort((left, right) => left - right)) {
        normalizedPresets[buildDomainSlotKey(hostname, slot)] = slots[slot];
      }
    }

    return {
      version: STATE_VERSION,
      autoApply: source.autoApply !== false,
      defaultFilters: normalizeFilters(source.defaultFilters || DEFAULT_FILTERS),
      presets: prunePresets(normalizedPresets)
    };
  }

  function parsePresetKey(key, preset) {
    const domainSlotMatch = key.match(/^domain:(.*):([1-3])$/);
    if (domainSlotMatch) {
      return {
        hostname: domainSlotMatch[1],
        slot: Number(domainSlotMatch[2]),
        priority: 0
      };
    }

    if (key.startsWith("domain:")) {
      return {
        hostname: key.slice("domain:".length) || preset.hostname,
        slot: 1,
        priority: 1
      };
    }

    if (key.startsWith("url:")) {
      const hostname = preset.hostname || extractHostname(preset.href) || extractHostname(key.slice("url:".length)) || extractHostname(preset.label);
      if (!hostname) {
        return null;
      }

      return {
        hostname,
        slot: 0,
        priority: 2
      };
    }

    return null;
  }

  function normalizePreset(preset, hostname, slot) {
    const updatedAt = Number(preset.updatedAt) || 0;
    return {
      scope: "domain",
      slot,
      label: normalizeHostname(preset.hostname || hostname),
      filters: normalizeFilters(preset.filters),
      hostname: normalizeHostname(hostname),
      updatedAt,
      selectedAt: Number(preset.selectedAt) || updatedAt
    };
  }

  function prunePresets(presets) {
    const domainCounts = new Map();
    let bytes = 0;
    return Object.fromEntries(
      Object.entries(presets)
        .sort((left, right) => (right[1].updatedAt || 0) - (left[1].updatedAt || 0))
        .filter(([_key, preset]) => {
          const hostname = normalizeHostname(preset.hostname);
          const count = domainCounts.get(hostname) || 0;
          if (count >= MAX_DOMAIN_PRESETS) {
            return false;
          }
          domainCounts.set(hostname, count + 1);
          return true;
        })
        .slice(0, MAX_PRESETS)
        .filter(([_key, preset]) => {
          bytes += buildStoredPresetKey(preset.hostname, preset.slot).length +
            JSON.stringify(toStoredPreset(preset)).length;
          return bytes <= PRESET_BYTES_BUDGET;
        })
        .sort((left, right) => left[0].localeCompare(right[0]))
    );
  }

  function getDomainPresets(state, hostname) {
    return Array.from({ length: MAX_DOMAIN_PRESETS }, (_value, index) => index + 1)
      .map((slot) => state.presets[buildDomainSlotKey(hostname, slot)])
      .filter(Boolean);
  }

  function findOpenSlot(slots) {
    for (let slot = 1; slot <= MAX_DOMAIN_PRESETS; slot += 1) {
      if (!slots[slot]) {
        return slot;
      }
    }
    return 0;
  }

  function normalizeSlot(value) {
    const slot = Number(value);
    if (Number.isInteger(slot) && slot >= 1 && slot <= MAX_DOMAIN_PRESETS) {
      return slot;
    }
    return 1;
  }

  function buildDomainSlotKey(hostname, slot) {
    return `domain:${normalizeHostname(hostname)}:${slot}`;
  }

  function normalizeHostname(value) {
    return String(value || "").trim().toLowerCase();
  }

  function extractHostname(value) {
    try {
      return normalizeHostname(new URL(String(value || "")).hostname);
    } catch {
      return "";
    }
  }

  function normalizeFilters(filters) {
    const source = isObject(filters) ? filters : {};
    return {
      brightness: clampNumber(source.brightness, ...FILTER_LIMITS.brightness, DEFAULT_FILTERS.brightness),
      contrast: clampNumber(source.contrast, ...FILTER_LIMITS.contrast, DEFAULT_FILTERS.contrast),
      saturation: clampNumber(source.saturation, ...FILTER_LIMITS.saturation, DEFAULT_FILTERS.saturation),
      warmth: clampNumber(source.warmth, ...FILTER_LIMITS.warmth, DEFAULT_FILTERS.warmth)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function isDefaultFilters(filters) {
    return filters.brightness === DEFAULT_FILTERS.brightness &&
      filters.contrast === DEFAULT_FILTERS.contrast &&
      filters.saturation === DEFAULT_FILTERS.saturation &&
      filters.warmth === DEFAULT_FILTERS.warmth;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object";
  }

  globalThis.VideoTheaterStore = Object.freeze({
    STORAGE_KEY,
    PRESET_KEY_PREFIX,
    MAX_DOMAIN_PRESETS,
    DEFAULT_FILTERS,
    DEFAULT_STATE,
    loadState,
    saveState,
    migrateLegacyState,
    isStorageKey,
    normalizeState,
    normalizeFilters,
    normalizeSlot,
    normalizeHostname,
    buildDomainSlotKey,
    getDomainPresets,
    isDefaultFilters
  });
})();
