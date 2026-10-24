const store = globalThis.VideoTheaterStore;

let state = store.normalizeState(store.DEFAULT_STATE);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  localizeDocument();

  document.getElementById("autoApply").addEventListener("change", async (event) => {
    const nextState = { ...state, autoApply: event.target.checked };
    if (await persist(nextState)) {
      setStatus("optionsSaved", "Saved.");
    }
  });
  document.getElementById("resetAll").addEventListener("click", resetAll);

  // Keep the table current while presets are saved or cleared from the popup in another tab.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && Object.keys(changes).some(store.isStorageKey)) {
      refresh();
    }
  });

  await refresh();
}

async function refresh() {
  try {
    state = await store.loadState();
  } catch {
    setStatus("optionsLoadError", "Unable to load saved presets.");
  }
  render();
}

async function persist(nextState) {
  try {
    state = await store.saveState(nextState);
    render();
    return true;
  } catch {
    render();
    setStatus("optionsSaveError", "Unable to save changes. Please try again.");
    return false;
  }
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
    const presets = { ...state.presets };
    delete presets[key];
    if (await persist({ ...state, presets })) {
      setStatus("presetDeleted", "Preset deleted.");
    }
  });
  cell.appendChild(button);
  return cell;
}

async function resetAll() {
  if (!window.confirm(getMessage("resetAllConfirm", "Delete every saved Video Theater preset? This cannot be undone."))) {
    return;
  }

  if (await persist(store.DEFAULT_STATE)) {
    setStatus("resetAllDone", "All saved presets were deleted.");
  }
}

function formatSlotLabel(slot) {
  return getMessage("quickPresetLabel", "Quick {slot}").replace("{slot}", String(slot));
}

function formatFilters(filters) {
  const normalized = store.normalizeFilters(filters);
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
