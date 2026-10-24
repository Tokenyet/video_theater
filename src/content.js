(() => {
  const MESSAGE_TYPE = "video-theater";
  const STYLE_ID = "video-theater-filter-style";
  const LEGACY_FILTER_PROPERTY = "--video-theater-filter";
  const INSTANCE_KEY = "__videoTheaterContentScript";
  const ELEMENT_NODE = 1;
  const DOCUMENT_FRAGMENT_NODE = 11;
  const PENDING_HOST_INTERVAL_MS = 500;
  const PENDING_HOST_TTL_MS = 30000;

  // The popup re-injects this script into tabs that were open before an install or update.
  // Skip if a live instance already runs in this world; an orphaned one (from before an
  // extension reload) has a dead chrome.runtime and must be replaced.
  const previousInstance = globalThis[INSTANCE_KEY];
  if (previousInstance && previousInstance.runtime === chrome.runtime && isExtensionAlive()) {
    return;
  }
  // Shadow roots keep the sheet they adopted, so a replacement instance takes over the same one
  // instead of leaving a stale filter behind.
  const shadowSheet = previousInstance?.shadowSheet || createShadowSheet();
  const instance = { runtime: chrome.runtime, shadowSheet };
  globalThis[INSTANCE_KEY] = instance;

  const store = globalThis.VideoTheaterStore;
  const { DEFAULT_FILTERS } = store;
  const IS_TOP_FRAME = window.top === window.self;
  let state = store.normalizeState(store.DEFAULT_STATE);
  let currentFilters = { ...DEFAULT_FILTERS };
  let styleElement = null;
  let mutationObserver = null;
  let reloading = false;
  let reloadRequested = false;

  // The document <style> cannot reach <video> elements inside shadow trees, so open shadow
  // roots that hold videos adopt a shared sheet carrying the same rule.
  const watchedRoots = new WeakSet();
  const videoRoots = new WeakSet();
  const videoRootRefs = new Set();
  const pendingHosts = new Map();
  let pendingTimer = 0;

  // Listeners are registered synchronously so the popup can always reach this frame,
  // even while (or if) the initial storage read is still pending or has failed.
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage.onChanged.addListener(handleStorageChange);
  const ready = init().catch(() => {});

  async function init() {
    document.documentElement?.style?.removeProperty?.(LEGACY_FILTER_PROPERTY);
    observeDocument();
    scanTree(document, null);
    rescanAfterLoad();
    state = await store.loadState();
    currentFilters = getInitialFilters(state);
    applyFilters(currentFilters);
  }

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (!message || message.type !== MESSAGE_TYPE) {
      return false;
    }

    if (!IS_TOP_FRAME) {
      ready.then(() => handleChildFrameMessage(message));
      return false;
    }

    ready
      .then(() => handleMessage(message))
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "sync" || !Object.keys(changes).some(store.isStorageKey)) {
      return;
    }

    // One save can emit several change events (remove + set); coalesce them into one reload,
    // and reload again if more changes land while a reload is in flight.
    reloadRequested = true;
    if (reloading) {
      return;
    }

    reloading = true;
    ready
      .then(async () => {
        while (reloadRequested) {
          reloadRequested = false;
          try {
            state = await store.loadState();
            currentFilters = getInitialFilters(state);
            applyFilters(currentFilters);
          } catch {
            // Keep the filters already on the page.
          }
        }
      })
      .finally(() => {
        reloading = false;
      });
  }

  function handleChildFrameMessage(message) {
    if (message.action === "setFilters" || message.action === "applyPreset") {
      if (message.filters) {
        currentFilters = store.normalizeFilters(message.filters);
        applyFilters(currentFilters);
      }
    }

    if (message.action === "resetAll") {
      currentFilters = { ...DEFAULT_FILTERS };
      applyFilters(currentFilters);
    }

    // Only the top frame answers the popup, so embedded players report their videos separately.
    if (message.action === "reportVideos") {
      const videosCount = countVideos({ rescan: true });
      if (videosCount > 0) {
        try {
          chrome.runtime.sendMessage({ type: MESSAGE_TYPE, action: "frameVideos", videosCount }).catch(() => {});
        } catch {
          // The popup closed or the extension was reloaded.
        }
      }
    }
  }

  async function handleMessage(message) {
    if (message.action === "reportVideos") {
      return { videosCount: countVideos({ rescan: true }) };
    }

    // Slider previews arrive every few milliseconds and change nothing in storage; the
    // onChanged listener already keeps `state` current for them.
    if (message.action !== "setFilters") {
      state = await store.loadState();
    }

    if (message.action === "getState") {
      return { state: buildPublicState({ rescan: true }) };
    }

    if (message.action === "setFilters") {
      currentFilters = store.normalizeFilters(message.filters);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "savePreset") {
      const slot = store.normalizeSlot(message.slot);
      currentFilters = store.normalizeFilters(message.filters || currentFilters);
      applyFilters(currentFilters);
      state = await savePreset(slot, currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "applyPreset") {
      const slot = store.normalizeSlot(message.slot);
      state = await selectPreset(slot);
      currentFilters = store.normalizeFilters(getPresetBySlot(state, slot)?.filters || currentFilters);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "clearPreset") {
      const slot = store.normalizeSlot(message.slot);
      state = await clearPreset(slot);
      currentFilters = getInitialFilters(state);
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    if (message.action === "resetAll") {
      state = await store.saveState(store.DEFAULT_STATE);
      currentFilters = { ...DEFAULT_FILTERS };
      applyFilters(currentFilters);
      return { state: buildPublicState() };
    }

    throw new Error(`Unknown action: ${message.action}`);
  }

  function ensureStyle() {
    if (styleElement?.isConnected) {
      return styleElement;
    }

    // Reuse the element left behind by an orphaned instance instead of stacking duplicates.
    styleElement = document.getElementById(STYLE_ID) || styleElement || document.createElement("style");
    styleElement.id = STYLE_ID;

    const parent = document.head || document.documentElement;
    if (parent && !styleElement.isConnected) {
      parent.appendChild(styleElement);
    }
    return styleElement;
  }

  function observeDocument() {
    if (mutationObserver || !document.documentElement) {
      return;
    }

    mutationObserver = new MutationObserver((records) => {
      if (!isCurrentInstance()) {
        mutationObserver.disconnect();
        return;
      }
      if (styleElement && !styleElement.isConnected) {
        ensureStyle();
      }
      scanAddedNodes(records);
    });
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Page scripts often attach a shadow root to a placeholder element the parser inserted earlier,
  // which no mutation record reports. Look once more when the document is parsed and loaded.
  function rescanAfterLoad() {
    if (document.readyState === "complete") {
      return;
    }
    const rescan = () => {
      if (isCurrentInstance()) {
        scanTree(document, null, true);
      }
    };
    document.addEventListener("DOMContentLoaded", rescan, { once: true });
    window.addEventListener("load", rescan, { once: true });
  }

  // Only the nodes a mutation added are walked, so busy pages never trigger a whole-document scan.
  function scanAddedNodes(records) {
    const seen = new Set();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === ELEMENT_NODE && !seen.has(node) && node.isConnected) {
          scanTree(node, seen);
        }
      }
    }
  }

  // Walks `container` (the document, an element or a shadow root) and the open shadow roots
  // below it. Roots that are already watched are skipped unless `revisit` is set, because the
  // observer reports their changes.
  function scanTree(container, seen, revisit = false) {
    if (container.nodeType === ELEMENT_NODE) {
      visitElement(container, seen, revisit);
    }
    for (const element of container.querySelectorAll("*")) {
      visitElement(element, seen, revisit);
    }
  }

  function visitElement(element, seen, revisit) {
    seen?.add(element);
    if (element.localName === "video") {
      trackVideo(element);
    }

    const root = element.shadowRoot;
    if (root) {
      if (watchShadowRoot(root) || revisit) {
        scanTree(root, seen, revisit);
      }
    } else if (element.localName.includes("-") && !element.matches(":defined")) {
      trackPendingHost(element);
    }
  }

  function watchShadowRoot(root) {
    if (watchedRoots.has(root)) {
      return false;
    }
    watchedRoots.add(root);
    // Mutations inside a shadow tree never reach the document observer.
    mutationObserver?.observe(root, { childList: true, subtree: true });
    return true;
  }

  function trackVideo(video) {
    const root = video.getRootNode();
    if (root.nodeType !== DOCUMENT_FRAGMENT_NODE || !root.host) {
      return;
    }
    if (!videoRoots.has(root)) {
      videoRoots.add(root);
      videoRootRefs.add(new WeakRef(root));
    }
    adoptShadowSheet(root);
  }

  // A custom element that is not upgraded yet attaches its shadow root later, which no mutation
  // record reports, so look at it again until it is defined, removed, or the TTL runs out.
  function trackPendingHost(element) {
    pendingHosts.set(element, Date.now() + PENDING_HOST_TTL_MS);
    if (!pendingTimer) {
      pendingTimer = setTimeout(checkPendingHosts, PENDING_HOST_INTERVAL_MS);
    }
  }

  function checkPendingHosts() {
    pendingTimer = 0;
    if (!isCurrentInstance()) {
      pendingHosts.clear();
      return;
    }

    const now = Date.now();
    for (const [host, deadline] of pendingHosts) {
      if (host.shadowRoot) {
        pendingHosts.delete(host);
        if (host.isConnected) {
          scanTree(host, null);
        }
      } else if (!host.isConnected || host.matches(":defined") || now > deadline) {
        pendingHosts.delete(host);
      }
    }

    if (pendingHosts.size > 0) {
      pendingTimer = setTimeout(checkPendingHosts, PENDING_HOST_INTERVAL_MS);
    }
  }

  // Shadow roots holding videos that are still in the page; roots the page dropped are forgotten.
  function getVideoRoots() {
    const roots = [];
    for (const ref of videoRootRefs) {
      const root = ref.deref();
      if (!root) {
        videoRootRefs.delete(ref);
      } else if (root.host.isConnected) {
        roots.push(root);
      }
    }
    return roots;
  }

  function createShadowSheet() {
    try {
      return new CSSStyleSheet();
    } catch {
      return null;
    }
  }

  function adoptShadowSheet(root) {
    if (!shadowSheet) {
      return;
    }
    try {
      const sheets = root.adoptedStyleSheets;
      if (!sheets.includes(shadowSheet)) {
        root.adoptedStyleSheets = [...sheets, shadowSheet];
      }
    } catch {
      // Leave a root that refuses the sheet alone.
    }
  }

  function applyFilters(filters) {
    const filter = buildCssFilter(filters);
    // With neutral settings no rule is emitted, so a site's own video filters are left alone.
    const rule = filter === "none" ? "" : `video { filter: ${filter} !important; }`;
    ensureStyle().textContent = rule;

    if (shadowSheet) {
      shadowSheet.replaceSync(rule);
      // Re-adopt in case a page replaced a root's adoptedStyleSheets after we added ours.
      for (const root of getVideoRoots()) {
        adoptShadowSheet(root);
      }
    }
  }

  function countVideos({ rescan = false } = {}) {
    // The popup asks rarely, so a full pass here also picks up roots attached in ways the
    // observer cannot see.
    if (rescan) {
      scanTree(document, null, true);
    }
    let count = document.querySelectorAll("video").length;
    for (const root of getVideoRoots()) {
      count += root.querySelectorAll("video").length;
    }
    return count;
  }

  function buildCssFilter(filters) {
    const normalized = store.normalizeFilters(filters);
    if (store.isDefaultFilters(normalized)) {
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
    return store.normalizeFilters(preset?.filters || nextState.defaultFilters);
  }

  function findBestPreset(nextState) {
    const { hostname } = getDomainInfo();
    return store.getDomainPresets(nextState, hostname)
      .sort((left, right) => {
        const leftSelected = left.selectedAt || left.updatedAt || 0;
        const rightSelected = right.selectedAt || right.updatedAt || 0;
        return rightSelected - leftSelected || (right.updatedAt || 0) - (left.updatedAt || 0);
      })[0] || null;
  }

  async function savePreset(slot, filters) {
    const { hostname, domainLabel } = getDomainInfo();
    const nextState = store.normalizeState(state);
    const now = Date.now();

    nextState.presets[store.buildDomainSlotKey(hostname, slot)] = {
      scope: "domain",
      slot,
      label: domainLabel,
      filters: store.normalizeFilters(filters),
      hostname,
      updatedAt: now,
      selectedAt: now
    };

    return store.saveState(nextState);
  }

  async function selectPreset(slot) {
    const nextState = store.normalizeState(state);
    const preset = getPresetBySlot(nextState, slot);

    if (!preset) {
      throw new Error(`No preset saved in slot ${slot}`);
    }

    nextState.presets[store.buildDomainSlotKey(preset.hostname, slot)] = {
      ...preset,
      selectedAt: Date.now()
    };

    return store.saveState(nextState);
  }

  async function clearPreset(slot) {
    const { hostname } = getDomainInfo();
    const nextState = store.normalizeState(state);
    delete nextState.presets[store.buildDomainSlotKey(hostname, slot)];
    return store.saveState(nextState);
  }

  function buildPublicState({ rescan = false } = {}) {
    const { hostname, domainLabel } = getDomainInfo();
    const activePreset = findBestPreset(state);
    return {
      filters: store.normalizeFilters(currentFilters),
      defaultFilters: store.normalizeFilters(state.defaultFilters),
      autoApply: state.autoApply,
      activePreset: activePreset ? {
        scope: "domain",
        slot: activePreset.slot,
        label: activePreset.label,
        updatedAt: activePreset.updatedAt
      } : null,
      domainPresets: store.getDomainPresets(state, hostname).map((preset) => ({
        slot: preset.slot,
        label: preset.label,
        filters: store.normalizeFilters(preset.filters),
        updatedAt: preset.updatedAt,
        selectedAt: preset.selectedAt
      })),
      domainLabel,
      videosCount: countVideos({ rescan })
    };
  }

  function getDomainInfo() {
    const url = new URL(getSiteHref());
    const hostname = store.normalizeHostname(url.hostname || url.origin || url.protocol || "local");
    return {
      hostname,
      domainLabel: hostname
    };
  }

  // Embedded players (e.g. a YouTube iframe) follow the presets of the page the user is on,
  // which is the domain the popup shows and saves under.
  function getSiteHref() {
    if (!IS_TOP_FRAME) {
      const origins = location.ancestorOrigins;
      const topOrigin = origins?.length ? origins[origins.length - 1] : "";
      if (topOrigin && topOrigin !== "null") {
        return topOrigin;
      }
    }
    return location.href;
  }

  function getPresetBySlot(nextState, slot) {
    const { hostname } = getDomainInfo();
    return nextState.presets[store.buildDomainSlotKey(hostname, slot)] || null;
  }

  function isExtensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  // A re-injected instance takes over the page; the one it replaced stops its observers.
  function isCurrentInstance() {
    return globalThis[INSTANCE_KEY] === instance && isExtensionAlive();
  }
})();
