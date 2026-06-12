const MESSAGE_TYPE = "video-theater";
const MAX_DOMAIN_PRESETS = 3;
const DEFAULT_FILTERS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0
};

const controls = {};
let applyTimer = 0;
let lastState = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  localizeDocument();
  for (const name of Object.keys(DEFAULT_FILTERS)) {
    controls[name] = document.getElementById(name);
    controls[name].addEventListener("input", () => {
      syncOutputs();
      scheduleApply();
    });
  }

  document.getElementById("preset-slots").addEventListener("click", handleSlotClick);
  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

  await refreshState();
}

async function refreshState() {
  setDisabled(true);
  try {
    const response = await sendToCurrentTab({ action: "getState" });
    if (!response.ok) {
      throw new Error(response.error || getMessage("unknownError", "Unknown error"));
    }
    lastState = response.state;
    setDisabled(false);
    setFormValues(lastState.filters);
    renderState(lastState);
  } catch (error) {
    setStatus("unsupportedPage", "This page cannot be adjusted.");
    document.getElementById("page-scope").textContent = getMessage("unsupportedPage", "This page cannot be adjusted.");
  }
}

function setFormValues(filters) {
  for (const [name, value] of Object.entries({ ...DEFAULT_FILTERS, ...filters })) {
    controls[name].value = value;
  }
  syncOutputs();
}

function syncOutputs() {
  for (const name of Object.keys(DEFAULT_FILTERS)) {
    document.getElementById(`${name}Value`).textContent = `${controls[name].value}%`;
  }
}

function scheduleApply() {
  clearTimeout(applyTimer);
  applyTimer = window.setTimeout(applyCurrentFilters, 60);
}

async function applyCurrentFilters() {
  try {
    const response = await sendToCurrentTab({ action: "setFilters", filters: readFilters() });
    if (response.ok) {
      lastState = response.state;
      renderState(response.state);
    }
  } catch {
    setStatus("unsupportedPage", "This page cannot be adjusted.");
  }
}

async function handleSlotClick(event) {
  const button = event.target.closest("button[data-action][data-slot]");
  if (!button) {
    return;
  }

  const slot = Number(button.dataset.slot);
  if (button.dataset.action === "apply") {
    await applyPreset(slot);
  }
  if (button.dataset.action === "save") {
    await savePreset(slot);
  }
  if (button.dataset.action === "clear") {
    await clearPreset(slot);
  }
}

async function applyPreset(slot) {
  const response = await sendToCurrentTab({ action: "applyPreset", slot });
  if (!response.ok) {
    setStatus("resetError", "Unable to reset.");
    return;
  }

  lastState = response.state;
  setFormValues(response.state.filters);
  renderState(response.state);
  await syncFiltersToFrames(response.state.filters);
  setStatus("appliedPreset", "Applied quick setting {slot}.", { slot });
}

async function savePreset(slot) {
  setStatus("savingPreset", "Saving quick setting...");
  const filters = readFilters();
  const response = await sendToCurrentTab({ action: "savePreset", slot, filters });
  if (!response.ok) {
    setStatus("saveError", "Unable to save preset.");
    return;
  }

  lastState = response.state;
  renderState(response.state);
  await syncFiltersToFrames(filters);
  setStatus("savedPreset", "Saved quick setting {slot}.", { slot });
}

async function clearPreset(slot) {
  const response = await sendToCurrentTab({ action: "clearPreset", slot });
  if (!response.ok) {
    setStatus("resetError", "Unable to reset.");
    return;
  }

  lastState = response.state;
  setFormValues(response.state.filters);
  renderState(response.state);
  await syncFiltersToFrames(response.state.filters);
  setStatus("clearPresetDone", "Quick setting {slot} was cleared.", { slot });
}

async function resetFilters() {
  setFormValues(DEFAULT_FILTERS);
  await applyCurrentFilters();
  setStatus("resetFiltersDone", "This tab is previewing neutral settings.");
}

function renderState(state) {
  document.getElementById("page-scope").textContent = state.domainLabel || "";
  document.getElementById("active-preset").textContent = state.activePreset ?
    formatSlotLabel(state.activePreset.slot) :
    getMessage("presetDefault", "Default");
  renderPresetSlots(state);
  document.getElementById("video-count").textContent = getMessage(
    "videoCount",
    "{count} video element(s) found."
  ).replace("{count}", String(state.videosCount ?? 0));
}

function renderPresetSlots(state) {
  const container = document.getElementById("preset-slots");
  const activeSlot = state.activePreset?.slot || 0;
  const presetsBySlot = new Map((state.domainPresets || []).map((preset) => [preset.slot, preset]));

  container.textContent = "";
  for (let slot = 1; slot <= MAX_DOMAIN_PRESETS; slot += 1) {
    const preset = presetsBySlot.get(slot);
    const row = document.createElement("div");
    const applyButton = document.createElement("button");
    const title = document.createElement("span");
    const summary = document.createElement("span");
    const saveButton = document.createElement("button");
    const clearButton = document.createElement("button");

    row.className = "slot-row";

    applyButton.type = "button";
    applyButton.className = `slot-apply${preset && activeSlot === slot ? " is-active" : ""}`;
    applyButton.dataset.action = "apply";
    applyButton.dataset.slot = String(slot);
    applyButton.disabled = !preset;

    title.className = "slot-title";
    title.textContent = formatSlotLabel(slot);
    summary.className = "slot-summary";
    summary.textContent = preset ? formatCompactFilters(preset.filters) : getMessage("emptyPresetSlot", "Empty");
    applyButton.append(title, summary);

    saveButton.type = "button";
    saveButton.className = "secondary";
    saveButton.dataset.action = "save";
    saveButton.dataset.slot = String(slot);
    saveButton.textContent = getMessage("savePresetButton", "Save");

    clearButton.type = "button";
    clearButton.className = "secondary";
    clearButton.dataset.action = "clear";
    clearButton.dataset.slot = String(slot);
    clearButton.disabled = !preset;
    clearButton.textContent = getMessage("clearPresetButton", "Clear");

    row.append(applyButton, saveButton, clearButton);
    container.appendChild(row);
  }
}

function readFilters() {
  return Object.fromEntries(
    Object.keys(DEFAULT_FILTERS).map((name) => [name, Number(controls[name].value)])
  );
}

async function syncFiltersToFrames(filters) {
  try {
    await sendToCurrentTab({ action: "setFilters", filters });
  } catch {
    // The primary action already succeeded; frame sync is best effort.
  }
}

async function sendToCurrentTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab");
  }

  return chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPE, ...payload });
}

function setDisabled(disabled) {
  for (const element of document.querySelectorAll("button, input")) {
    element.disabled = disabled;
  }
  document.getElementById("open-options").disabled = false;
}

function setStatus(key, fallback, values = {}) {
  let message = getMessage(key, fallback);
  for (const [name, value] of Object.entries(values)) {
    message = message.replace(`{${name}}`, String(value));
  }
  document.getElementById("status").textContent = message;
}

function formatSlotLabel(slot) {
  return getMessage("quickPresetLabel", "Quick {slot}").replace("{slot}", String(slot));
}

function formatCompactFilters(filters) {
  const normalized = { ...DEFAULT_FILTERS, ...filters };
  return getMessage(
    "compactFiltersSummary",
    "B {brightness} / C {contrast} / S {saturation} / W {warmth}"
  )
    .replace("{brightness}", normalized.brightness)
    .replace("{contrast}", normalized.contrast)
    .replace("{saturation}", normalized.saturation)
    .replace("{warmth}", normalized.warmth);
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage?.() || "en";
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const message = getMessage(element.dataset.i18n, element.textContent);
    element.textContent = message;
  }
}

function getMessage(key, fallback) {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
}
