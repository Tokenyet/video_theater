(() => {
  const MESSAGE_TYPE = "video-theater";
  const STORAGE_KEY = "videoTheaterState";
  const STYLE_ID = "video-theater-filter-style";
  const MAX_PRESETS = 300;
  const MAX_DOMAIN_PRESETS = 3;

  const FILTER_LIMITS = {
    brightness: [0, 250],
    contrast: [25, 250],
    saturation: [0, 250],
    warmth: [0, 40]
  };

  const DEFAULT_FILTERS = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    warmth: 0
  };

  const DEFAULT_STATE = {
    version: 2,
    autoApply: true,
    defaultFilters: DEFAULT_FILTERS,
    presets: {}
  };

  const IS_TOP_FRAME = window.top === window.self;
  let state = { ...DEFAULT_STATE };
  let currentFilters = { ...DEFAULT_FILTERS };
  let mutationObserver = null;

  init();

  async function init() {
    ensureStyle();
    state = await loadState();
    currentFilters = getInitialFilters(state);
    applyFilters(currentFilters);
    observeDocument();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[STORAGE_KEY]) {
        return;
      }

      state = normalizeState(changes[STORAGE_KEY].newValue);
      currentFilters = getInitialFilters(state);
      applyFilters(currentFilters);
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || message.type !== MESSAGE_TYPE) {
        return false;
      }

      if (!IS_TOP_FRAME) {
        handleChildFrameMessage(message);
        return false;
      }

      handleMessage(message)
        .then((payload) => sendResponse({ ok: true, ...payload }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    });
  }

  function handleChildFrameMessage(message) {
    if (message.action === "setFilters" || message.action === "applyPreset") {
      if (message.filters) {
        currentFilters = normalizeFilters(message.filters);
        applyFilters(currentFilters);
      }
    }

    if (message.action === "resetAll") {
      currentFilters = { ...DEFAULT_FILTERS };
      applyFilters(currentFilters);
    }
  }

  async function handleMessage(message) {
    state = await loadState();

    if (message.action === "getState") {
      return { state: buildPublicState() };
    }

    if (message.action === "setFilters") {
      currentFilters = normalizeFilters(message.filters);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "savePreset") {
      const slot = normalizeSlot(message.slot);
      currentFilters = normalizeFilters(message.filters || currentFilters);
      applyFilters(currentFilters);
      state = await savePreset(slot, currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "applyPreset") {
      const slot = normalizeSlot(message.slot);
      state = await selectPreset(slot);
      currentFilters = normalizeFilters(getPresetBySlot(state, slot)?.filters || currentFilters);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "clearPreset") {
      const slot = normalizeSlot(message.slot);
      state = await clearPreset(slot);
      currentFilters = getInitialFilters(state);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "resetAll") {
      state = await resetAllState();
      currentFilters = { ...DEFAULT_FILTERS };
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    throw new Error(`Unknown action: ${message.action}`);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      video {
        filter: var(--video-theater-filter, none) !important;
      }
    `;

    const parent = document.head || document.documentElement || document.body;
    if (parent) {
      parent.appendChild(style);
    }
  }

  function observeDocument() {
    if (mutationObserver || !document.documentElement) {
      return;
    }

    mutationObserver = new MutationObserver(() => ensureStyle());
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function applyFilters(filters) {
    ensureStyle();
    document.documentElement.style.setProperty("--video-theater-filter", buildCssFilter(filters));
  }

  function buildCssFilter(filters) {
    const normalized = normalizeFilters(filters);
    if (isDefaultFilters(normalized)) {
      return "none";
    }

    const parts = [
      `brightness(${normalized.brightness}%)`,
      `contrast(${normalized.contrast}%)`,
      `saturate(${normalized.saturation}%)`
    ];

    if (normalized.warmth > 0) {
      parts.push(`sepia(${normalized.warmth}%)`, "hue-rotate(-6deg)");
    }

    return parts.join(" ");
  }

  function getInitialFilters(nextState) {
    if (!nextState.autoApply) {
      return { ...DEFAULT_FILTERS };
    }

    const preset = findBestPreset(nextState);
    return normalizeFilters(preset?.filters || nextState.defaultFilters);
  }

  function findBestPreset(nextState) {
    const { hostname } = getDomainInfo();
    return getDomainPresets(nextState, hostname)
      .sort((left, right) => {
        const leftSelected = left.selectedAt || left.updatedAt || 0;
        const rightSelected = right.selectedAt || right.updatedAt || 0;
        return rightSelected - leftSelected || (right.updatedAt || 0) - (left.updatedAt || 0);
      })[0] || null;
  }

  async function savePreset(slot, filters) {
    const { hostname, domainLabel } = getDomainInfo();
    const key = buildDomainSlotKey(hostname, slot);
    const nextState = normalizeState(state);
    const now = Date.now();

    nextState.presets[key] = {
      scope: "domain",
      slot,
      label: domainLabel,
      filters: normalizeFilters(filters),
      href: location.href,
      hostname,
      updatedAt: now,
      selectedAt: now
    };
    nextState.presets = prunePresets(nextState.presets);

    await saveState(nextState);
    return nextState;
  }

  async function selectPreset(slot) {
    const nextState = normalizeState(state);
    const preset = getPresetBySlot(nextState, slot);

    if (!preset) {
      throw new Error(`No preset saved in slot ${slot}`);
    }

    nextState.presets[buildDomainSlotKey(preset.hostname, slot)] = {
      ...preset,
      selectedAt: Date.now()
    };

    await saveState(nextState);
    return nextState;
  }

  async function clearPreset(slot) {
    const { hostname } = getDomainInfo();
    const nextState = normalizeState(state);
    delete nextState.presets[buildDomainSlotKey(hostname, slot)];
    await saveState(nextState);
    return nextState;
  }

  async function resetAllState() {
    const nextState = normalizeState(DEFAULT_STATE);
    await saveState(nextState);
    return nextState;
  }

  function buildPublicState() {
    const { hostname, domainLabel } = getDomainInfo();
    const activePreset = findBestPreset(state);
    return {
      filters: normalizeFilters(currentFilters),
      defaultFilters: normalizeFilters(state.defaultFilters),
      autoApply: state.autoApply,
      activePreset: activePreset ? {
        scope: "domain",
        slot: activePreset.slot,
        label: activePreset.label,
        updatedAt: activePreset.updatedAt
      } : null,
      domainPresets: getDomainPresets(state, hostname).map((preset) => ({
        slot: preset.slot,
        label: preset.label,
        filters: normalizeFilters(preset.filters),
        updatedAt: preset.updatedAt,
        selectedAt: preset.selectedAt
      })),
      domainLabel,
      videosCount: document.querySelectorAll("video").length
    };
  }

  function getDomainInfo() {
    const url = new URL(location.href);
    const hostname = normalizeHostname(url.hostname || url.origin || url.protocol || "local");
    return {
      hostname,
      domainLabel: hostname
    };
  }

  function getDomainPresets(nextState, hostname) {
    return Array.from({ length: MAX_DOMAIN_PRESETS }, (_value, index) => index + 1)
      .map((slot) => nextState.presets[buildDomainSlotKey(hostname, slot)])
      .filter(Boolean);
  }

  function getPresetBySlot(nextState, slot) {
    const { hostname } = getDomainInfo();
    return nextState.presets[buildDomainSlotKey(hostname, slot)] || null;
  }

  function buildDomainSlotKey(hostname, slot) {
    return `domain:${normalizeHostname(hostname)}:${slot}`;
  }

  async function loadState() {
    const result = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_STATE });
    return normalizeState(result[STORAGE_KEY]);
  }

  async function saveState(nextState) {
    state = normalizeState(nextState);
    await chrome.storage.sync.set({ [STORAGE_KEY]: state });
  }

  function normalizeState(value) {
    const source = value && typeof value === "object" ? value : {};
    const presets = source.presets && typeof source.presets === "object" ? source.presets : {};
    const groupedPresets = new Map();
    const candidates = [];

    for (const [key, preset] of Object.entries(presets)) {
      if (!preset || typeof preset !== "object") {
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
      version: 2,
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
      href: String(preset.href || ""),
      hostname: normalizeHostname(hostname),
      updatedAt,
      selectedAt: Number(preset.selectedAt) || updatedAt
    };
  }

  function prunePresets(presets) {
    const domainCounts = new Map();
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
        .sort((left, right) => left[0].localeCompare(right[0]))
    );
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
    const source = filters && typeof filters === "object" ? filters : {};
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
})();
