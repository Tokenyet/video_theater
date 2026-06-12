const STORAGE_KEY = "videoTheaterState";
const MAX_PRESETS = 300;
const MAX_DOMAIN_PRESETS = 3;
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

let state = { ...DEFAULT_STATE };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  localizeDocument();
  state = await loadState();
  render();

  document.getElementById("autoApply").addEventListener("change", async (event) => {
    state.autoApply = event.target.checked;
    await saveState(state);
    setStatus("optionsSaved", "Saved.");
  });

  document.getElementById("resetAll").addEventListener("click", resetAll);
}

function render() {
  document.getElementById("autoApply").checked = state.autoApply;
  renderPresets();
}

function renderPresets() {
  const tbody = document.getElementById("presets");
  tbody.textContent = "";
  const entries = Object.entries(state.presets)
    .sort((left, right) => {
      const byLabel = left[1].label.localeCompare(right[1].label);
      return byLabel || left[1].slot - right[1].slot;
    });

  if (entries.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan = 4;
    cell.textContent = getMessage("noPresets", "No saved presets yet.");
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  for (const [key, preset] of entries) {
    const row = document.createElement("tr");
    row.appendChild(buildTargetCell(preset));
    row.appendChild(buildTextCell(formatFilters(preset.filters)));
    row.appendChild(buildTextCell(formatDate(preset.updatedAt)));
    row.appendChild(buildActionCell(key));
    tbody.appendChild(row);
  }
}

function buildTargetCell(preset) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  const label = document.createElement("strong");
  const slot = document.createElement("span");

  wrapper.className = "target";
  label.textContent = preset.label;
  slot.textContent = formatSlotLabel(preset.slot);

  wrapper.append(label, slot);
  cell.appendChild(wrapper);
  return cell;
}

function buildTextCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function buildActionCell(key) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary";
  button.textContent = getMessage("deletePresetButton", "Delete");
  button.addEventListener("click", async () => {
    delete state.presets[key];
    await saveState(state);
    renderPresets();
    setStatus("presetDeleted", "Preset deleted.");
  });
  cell.appendChild(button);
  return cell;
}

async function resetAll() {
  if (!window.confirm(getMessage("resetAllConfirm", "Delete every saved Video Theater preset? This cannot be undone."))) {
    return;
  }

  state = normalizeState(DEFAULT_STATE);
  await saveState(state);
  render();
  setStatus("resetAllDone", "All saved presets were deleted.");
}

function formatSlotLabel(slot) {
  return getMessage("quickPresetLabel", "Quick {slot}").replace("{slot}", String(slot));
}

function formatFilters(filters) {
  const normalized = normalizeFilters(filters);
  return getMessage(
    "filtersSummary",
    "Brightness {brightness}%, contrast {contrast}%, saturation {saturation}%, warmth {warmth}%"
  )
    .replace("{brightness}", normalized.brightness)
    .replace("{contrast}", normalized.contrast)
    .replace("{saturation}", normalized.saturation)
    .replace("{warmth}", normalized.warmth);
}

function formatDate(value) {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
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
  const source = filters && typeof filters === "object" ? filters : {};
  return {
    brightness: clampNumber(source.brightness, 0, 250, DEFAULT_FILTERS.brightness),
    contrast: clampNumber(source.contrast, 25, 250, DEFAULT_FILTERS.contrast),
    saturation: clampNumber(source.saturation, 0, 250, DEFAULT_FILTERS.saturation),
    warmth: clampNumber(source.warmth, 0, 40, DEFAULT_FILTERS.warmth)
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function setStatus(key, fallback) {
  document.getElementById("status").textContent = getMessage(key, fallback);
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage?.() || "en";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = getMessage(element.dataset.i18n, element.textContent);
  }
}

function getMessage(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
}
