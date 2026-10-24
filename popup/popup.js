const MESSAGE_TYPE = "video-theater";
const MAX_DOMAIN_PRESETS = 3;
const NEW_ISSUE_URL = "https://github.com/Tokenyet/video_theater/issues/new";
const CONNECT_TIMEOUT_MS = 3000;
const FALLBACK_CONTENT_SCRIPTS = ["src/state.js", "src/content.js"];
const DEFAULT_FILTERS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0
};

const controls = {};
const frameVideoCounts = new Map();
let applyTimer = 0;
let lastState = null;
let activeTabId = null;

class PopupError extends Error {
  constructor(messageKey, fallback, { retryable = false } = {}) {
    super(fallback);
    this.messageKey = messageKey;
    this.retryable = retryable;
  }
}

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
  document.getElementById("retry").addEventListener("click", refreshState);
  chrome.runtime.onMessage.addListener(handleFrameVideos);

  await refreshState();
}

async function refreshState() {
  setDisabled(true);
  document.getElementById("retry").hidden = true;
  setStatus("", "");
  frameVideoCounts.clear();
  try {
    const response = await connectToActiveTab();
    if (!response?.ok) {
      throw new PopupError("unknownError", response?.error || "Unknown error", { retryable: true });
    }
    lastState = response.state;
    setDisabled(false);
    setFormValues(lastState.filters);
    renderState(lastState);
    requestFrameVideos();
  } catch (error) {
    showConnectionError(error);
  }
}

// The top frame only counts its own videos; embedded players (e.g. a YouTube iframe) answer
// this broadcast with a "frameVideos" message of their own.
function requestFrameVideos() {
  sendToCurrentTab({ action: "reportVideos" }).catch(() => {});
}

function handleFrameVideos(message, sender) {
  if (message?.type !== MESSAGE_TYPE || message.action !== "frameVideos") {
    return;
  }
  if (!sender.tab || sender.tab.id !== activeTabId || !sender.frameId) {
    return;
  }

  frameVideoCounts.set(sender.frameId, Math.max(0, Number(message.videosCount) || 0));
  if (lastState) {
    renderVideoCount(lastState);
  }
}

async function connectToActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new PopupError("unsupportedPage", "This page cannot be adjusted.");
  }
  activeTabId = tab.id;

  try {
    return await requestTopFrameState(tab.id);
  } catch (error) {
    if (error instanceof PopupError) {
      throw error;
    }
  }

  // Chrome does not add content scripts to tabs that were already open when the extension was
  // installed, updated, or reloaded, or while site access is limited to "on click". Opening the
  // popup grants activeTab, so inject into this tab now and ask again.
  await injectContentScript(tab);
  return requestTopFrameState(tab.id);
}

function requestTopFrameState(tabId) {
  let timer = 0;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new PopupError(
      "pageNotResponding",
      "The page is not responding. Wait for it to finish loading, then try again.",
      { retryable: true }
    )), CONNECT_TIMEOUT_MS);
  });
  const request = chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPE, action: "getState" }, { frameId: 0 });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

async function injectContentScript(tab) {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || FALLBACK_CONTENT_SCRIPTS;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
    return;
  } catch {
    // Some frames can refuse injection; the top frame is the one the popup talks to.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
  } catch {
    if (await needsFileAccess(tab)) {
      throw new PopupError(
        "fileAccessRequired",
        "To adjust local files, turn on \"Allow access to file URLs\" for Video Theater on the Extensions page."
      );
    }
    if (isScriptableUrl(tab.url)) {
      // A regular web page that refused injection is usually mid-navigation; let the user retry.
      throw new PopupError(
        "pageNotResponding",
        "The page is not responding. Wait for it to finish loading, then try again.",
        { retryable: true }
      );
    }
    throw new PopupError("unsupportedPage", "This page cannot be adjusted.");
  }
}

function isScriptableUrl(url = "") {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    const isWebStore = hostname === "chromewebstore.google.com" ||
      (hostname === "chrome.google.com" && pathname.startsWith("/webstore"));
    return ["http:", "https:", "file:"].includes(protocol) && !isWebStore;
  } catch {
    return false;
  }
}

async function needsFileAccess(tab) {
  if (!String(tab.url || "").startsWith("file:")) {
    return false;
  }
  try {
    return !(await chrome.extension.isAllowedFileSchemeAccess());
  } catch {
    return false;
  }
}

function showConnectionError(error) {
  const known = error instanceof PopupError;

  document.getElementById("page-scope").textContent = getMessage("unsupportedPage", "This page cannot be adjusted.");
  document.getElementById("preset-slots").textContent = "";
  document.getElementById("video-count").textContent = "";
  if (!known || error.messageKey === "unsupportedPage") {
    setStatus("unsupportedPageHint", "Browser pages, the Chrome Web Store, and other extensions cannot be changed.");
  } else {
    setStatus(error.messageKey, error.message);
  }
  document.getElementById("retry").hidden = !(known && error.retryable);
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
    if (response?.ok) {
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
  const action = button.dataset.action;
  try {
    if (action === "apply") {
      await applyPreset(slot);
    }
    if (action === "save") {
      await savePreset(slot);
    }
    if (action === "clear") {
      await clearPreset(slot);
    }
  } catch {
    if (action === "apply") {
      setStatus("applyError", "Unable to apply quick setting.");
    }
    if (action === "save") {
      setStatus("saveError", "Unable to save preset.");
    }
    if (action === "clear") {
      setStatus("clearError", "Unable to clear quick setting.");
    }
  }
}

async function applyPreset(slot) {
  const response = await sendToCurrentTab({ action: "applyPreset", slot });
  if (!response?.ok) {
    setStatus("applyError", "Unable to apply quick setting.");
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
  if (!response?.ok) {
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
  if (!response?.ok) {
    setStatus("clearError", "Unable to clear quick setting.");
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
  document.getElementById("report-issue").href = buildIssueUrl(state.domainLabel);
  document.getElementById("active-preset").textContent = state.activePreset ?
    formatSlotLabel(state.activePreset.slot) :
    getMessage("presetDefault", "Default");
  renderPresetSlots(state);
  renderVideoCount(state);
}

function renderVideoCount(state) {
  let count = Number(state.videosCount) || 0;
  for (const frameCount of frameVideoCounts.values()) {
    count += frameCount;
  }
  document.getElementById("video-count").textContent = getMessage(
    "videoCount",
    "{count} video element(s) found."
  ).replace("{count}", String(count));
}

function buildIssueUrl(hostname = "") {
  const manifestVersion = chrome.runtime.getManifest().version;
  const issueUrl = new URL(NEW_ISSUE_URL);
  const context = [
    `- Extension version: ${manifestVersion}`,
    `- Browser: ${navigator.userAgent}`,
    `- Website hostname: ${hostname || "Not available"}`
  ].join("\n");

  issueUrl.searchParams.set("title", "[Bug] ");
  issueUrl.searchParams.set(
    "body",
    `## What happened?\n\n\n## What did you expect?\n\n\n## Steps to reproduce\n1. \n\n## Context\n${context}`
  );
  return issueUrl.href;
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

// Broadcast to every frame: the top frame replies, embedded players apply the filters too.
async function sendToCurrentTab(payload) {
  if (!activeTabId) {
    throw new Error("No active tab");
  }

  return chrome.tabs.sendMessage(activeTabId, { type: MESSAGE_TYPE, ...payload });
}

function setDisabled(disabled) {
  for (const element of document.querySelectorAll("button, input")) {
    element.disabled = disabled;
  }
  document.getElementById("open-options").disabled = false;
  document.getElementById("retry").disabled = false;
}

function setStatus(key, fallback, values = {}) {
  let message = key ? getMessage(key, fallback) : fallback;
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
