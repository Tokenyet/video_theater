import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const stateSource = await readFile(new URL("../src/state.js", import.meta.url), "utf8");
const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const popupSource = await readFile(new URL("../popup/popup.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const STORAGE_KEY = "videoTheaterState";
const PRESET_KEY_PREFIX = "videoTheaterPreset:";
const SYNC_QUOTA_BYTES_PER_ITEM = 8192;
const SYNC_QUOTA_BYTES = 102400;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function delay(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function presetKey(hostname, slot) {
  return `${PRESET_KEY_PREFIX}${hostname}:${slot}`;
}

function itemBytes(key, value) {
  return key.length + JSON.stringify(value).length;
}

// Mirrors chrome.storage.sync, including its quotas and asynchronous onChanged events.
function createSyncStorage(store, { failGet = false } = {}) {
  const listeners = [];

  function emit(changes) {
    if (Object.keys(changes).length === 0) {
      return;
    }
    setTimeout(() => {
      for (const listener of listeners) {
        listener(clone(changes), "sync");
      }
    }, 0);
  }

  return {
    sync: {
      async get(keys) {
        if (failGet) {
          throw new Error("storage unavailable");
        }
        if (keys === null || keys === undefined) {
          return clone(store);
        }
        if (typeof keys === "string") {
          return keys in store ? { [keys]: clone(store[keys]) } : {};
        }

        const result = {};
        for (const [key, value] of Object.entries(keys)) {
          result[key] = clone(store[key] ?? value);
        }
        return result;
      },
      async set(nextValues) {
        const nextStore = { ...store, ...clone(nextValues) };
        for (const [key, value] of Object.entries(nextValues)) {
          if (itemBytes(key, value) > SYNC_QUOTA_BYTES_PER_ITEM) {
            throw new Error(`QUOTA_BYTES_PER_ITEM quota exceeded for ${key}`);
          }
        }
        const totalBytes = Object.entries(nextStore).reduce((sum, [key, value]) => sum + itemBytes(key, value), 0);
        if (totalBytes > SYNC_QUOTA_BYTES) {
          throw new Error("QUOTA_BYTES quota exceeded");
        }

        const changes = {};
        for (const [key, value] of Object.entries(nextValues)) {
          changes[key] = { oldValue: clone(store[key]), newValue: clone(value) };
          store[key] = clone(value);
        }
        emit(changes);
      },
      async remove(keys) {
        const changes = {};
        for (const key of [].concat(keys)) {
          if (key in store) {
            changes[key] = { oldValue: clone(store[key]) };
            delete store[key];
          }
        }
        emit(changes);
      }
    },
    onChanged: {
      addListener(listener) {
        listeners.push(listener);
      }
    }
  };
}

function createChrome(store, options) {
  const messageListeners = [];
  const sentMessages = [];
  return {
    messageListeners,
    sentMessages,
    storage: createSyncStorage(store, options),
    runtime: {
      id: "video-theater-test",
      onMessage: {
        addListener(listener) {
          messageListeners.push(listener);
        }
      },
      async sendMessage(message) {
        sentMessages.push(clone(message));
      }
    }
  };
}

async function settle() {
  await delay(0);
  await delay(0);
  await delay(0);
}

// A small DOM: element trees, open shadow roots, and childList MutationObserver records that are
// delivered as a microtask, like the real thing. Mutations inside a shadow tree only reach an
// observer that observes that shadow root.
function createDom() {
  const observers = new Set();
  const stats = { visited: 0 };

  function queueRecord(target, addedNodes, removedNodes) {
    for (const observer of observers) {
      if (observer.watches(target)) {
        observer.enqueue({ target, addedNodes, removedNodes });
      }
    }
  }

  class FakeNode {
    constructor(nodeType, localName = "") {
      this.nodeType = nodeType;
      this.localName = localName;
      this.childNodes = [];
      this.parentNode = null;
    }

    get isConnected() {
      const root = this.getRootNode();
      return root.nodeType === 9 || (root.nodeType === 11 && root.host.isConnected);
    }

    getRootNode() {
      let node = this;
      while (node.parentNode) {
        node = node.parentNode;
      }
      return node;
    }

    appendChild(node) {
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      this.childNodes.push(node);
      queueRecord(this, [node], []);
      return node;
    }

    append(...nodes) {
      for (const node of nodes) {
        this.appendChild(node);
      }
      return this;
    }

    removeChild(node) {
      this.childNodes.splice(this.childNodes.indexOf(node), 1);
      node.parentNode = null;
      queueRecord(this, [], [node]);
      return node;
    }

    remove() {
      this.parentNode?.removeChild(this);
    }

    descendants({ count = false } = {}) {
      const result = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (count) {
            stats.visited += 1;
          }
          result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    }

    querySelectorAll(selector) {
      return this.descendants({ count: true }).filter((node) => node.matches(selector));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    getElementById(id) {
      return this.descendants().find((node) => node.id === id) || null;
    }
  }

  class FakeElement extends FakeNode {
    constructor(localName) {
      super(1, localName);
      this.id = "";
      this.textContent = "";
      this.shadowRoot = null;
      this.defined = !localName.includes("-");
    }

    matches(selector) {
      if (selector === "*") {
        return true;
      }
      if (selector === ":defined") {
        return this.defined;
      }
      return selector === this.localName;
    }

    attachShadow() {
      this.shadowRoot = new FakeShadowRoot(this);
      return this.shadowRoot;
    }
  }

  class FakeShadowRoot extends FakeNode {
    constructor(host) {
      super(11);
      this.host = host;
      this.adoptedStyleSheets = [];
    }
  }

  class FakeDocument extends FakeNode {
    constructor() {
      super(9);
      this.head = null;
      this.readyState = "loading";
      this.listeners = [];
    }

    addEventListener(type, listener) {
      this.listeners.push({ type, listener });
    }

    get documentElement() {
      return this.childNodes[0] || null;
    }

    createElement(localName) {
      return new FakeElement(localName);
    }
  }

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      this.records = [];
    }

    observe(target) {
      this.targets.add(target);
      observers.add(this);
    }

    disconnect() {
      this.targets.clear();
      this.records = [];
      observers.delete(this);
    }

    watches(node) {
      for (let current = node; current; current = current.parentNode) {
        if (this.targets.has(current)) {
          return true;
        }
      }
      return false;
    }

    enqueue(record) {
      this.records.push(record);
      if (this.records.length === 1) {
        queueMicrotask(() => {
          const records = this.records;
          this.records = [];
          if (records.length > 0) {
            this.callback(records, this);
          }
        });
      }
    }
  }

  class FakeCSSStyleSheet {
    constructor() {
      this.cssText = "";
    }

    replaceSync(text) {
      this.cssText = text;
    }
  }

  const document = new FakeDocument();
  const html = document.appendChild(new FakeElement("html"));
  const body = html.appendChild(new FakeElement("body"));
  document.body = body;

  function element(localName, ...children) {
    return new FakeElement(localName).append(...children);
  }

  // A host element with an open shadow root holding `children`.
  function shadowHost(localName, ...children) {
    const host = new FakeElement(localName);
    host.defined = true;
    host.attachShadow().append(...children);
    return host;
  }

  return {
    document,
    html,
    body,
    stats,
    observers,
    element,
    shadowHost,
    FakeMutationObserver,
    FakeCSSStyleSheet
  };
}

async function createHarness({
  href,
  videos = 1,
  store = {},
  topFrame = true,
  ancestorOrigins = [],
  failGet = false,
  setup = () => {}
}) {
  const dom = createDom();
  const htmlStyle = {
    values: { "--video-theater-filter": "legacy" },
    removeProperty(name) {
      delete this.values[name];
    }
  };
  dom.html.style = htmlStyle;
  for (let index = 0; index < videos; index += 1) {
    dom.body.appendChild(dom.element("video"));
  }
  setup(dom);

  const chrome = createChrome(store, { failGet });
  const windowObject = {
    listeners: [],
    addEventListener(type, listener) {
      this.listeners.push({ type, listener });
    }
  };
  windowObject.self = windowObject;
  windowObject.top = topFrame ? windowObject : {};

  const context = vm.createContext({
    chrome,
    console,
    document: dom.document,
    location: { href, ancestorOrigins },
    CSSStyleSheet: dom.FakeCSSStyleSheet,
    MutationObserver: dom.FakeMutationObserver,
    setTimeout,
    clearTimeout,
    URL,
    window: windowObject
  });

  function inject() {
    vm.runInContext(stateSource, context, { filename: "src/state.js" });
    vm.runInContext(source, context, { filename: "src/content.js" });
  }

  inject();
  await settle();

  async function send(message) {
    assert.ok(chrome.messageListeners.length > 0, "content script message listener registered");
    const response = await new Promise((resolve) => {
      const keepOpen = chrome.messageListeners[0]({ type: "video-theater", ...message }, {}, resolve);
      if (!keepOpen) {
        resolve(undefined);
      }
    });
    await settle();
    return response;
  }

  function readFilter(text) {
    const match = text.match(/filter: (.*) !important/);
    return match ? match[1] : "none";
  }

  return {
    chrome,
    context,
    dom,
    inject,
    send,
    store,
    htmlStyle,
    // Fires a page lifecycle event on whichever of document/window has listeners for it.
    fire(type) {
      for (const target of [dom.document, windowObject]) {
        for (const entry of target.listeners.filter((candidate) => candidate.type === type)) {
          entry.listener({ type });
        }
      }
    },
    filter() {
      return readFilter(dom.document.getElementById("video-theater-filter-style")?.textContent || "");
    },
    // The filter a shadow root's videos get, or "unstyled" if the root never adopted the sheet.
    shadowFilter(root) {
      const sheet = context.__videoTheaterContentScript.shadowSheet;
      return root.adoptedStyleSheets.includes(sheet) ? readFilter(sheet.cssText) : "unstyled";
    }
  };
}

const base = await createHarness({
  href: "https://example.com/watch?v=1",
  videos: 2
});

let response = await base.send({ action: "getState" });
assert.equal(response.ok, true);
assert.equal(response.state.videosCount, 2);
assert.equal(base.filter(), "none");
assert.equal(response.state.domainLabel, "example.com");
assert.equal(response.state.domainPresets.length, 0);
assert.equal(base.htmlStyle.values["--video-theater-filter"], undefined, "legacy inline filter property is removed");
assert.deepEqual(Object.keys(base.store), [], "loading without changes writes nothing");

response = await base.send({
  action: "setFilters",
  filters: { brightness: 145, contrast: 112, saturation: 91, warmth: 8 }
});
assert.equal(response.ok, true);
assert.match(base.filter(), /brightness\(145%\)/);
assert.match(base.filter(), /contrast\(112%\)/);

response = await base.send({
  action: "setFilters",
  filters: { brightness: 0, contrast: 112, saturation: 91, warmth: 8 }
});
assert.equal(response.ok, true);
assert.match(base.filter(), /brightness\(0%\)/);

response = await base.send({
  action: "savePreset",
  slot: 1,
  filters: { brightness: 145, contrast: 112, saturation: 91, warmth: 8 }
});
assert.equal(response.ok, true);
assert.equal(base.store[presetKey("example.com", 1)].filters.brightness, 145);
assert.equal(base.store[presetKey("example.com", 1)].href, undefined, "page URLs are not stored");
assert.equal(base.store[STORAGE_KEY].presets, undefined, "presets are not kept in the settings item");
assert.equal(response.state.domainPresets.length, 1);
assert.equal(response.state.domainPresets[0].slot, 1);
assert.match(base.filter(), /brightness\(145%\)/);

response = await base.send({ action: "setFilters", filters: { brightness: 100, contrast: 100, saturation: 100, warmth: 0 } });
assert.equal(response.ok, true);
assert.equal(base.filter(), "none", "neutral settings leave the site's own video filters alone");

response = await base.send({ action: "reportVideos" });
assert.equal(response.ok, true);
assert.equal(response.videosCount, 2, "the top frame answers the popup's frame broadcast");
assert.deepEqual(base.chrome.sentMessages, [], "the top frame reports through its reply only");

// Videos inside open shadow roots (Reddit's shreddit-player, media-chrome based players) are out
// of reach of the document <style>, so they get the same rule through an adopted sheet.
{
  let existing;
  let nested;
  const shadow = await createHarness({
    href: "https://shadow.test/",
    setup(dom) {
      // Already on the page when the script is injected, as after a popup re-injection.
      existing = dom.shadowHost("shreddit-player", dom.element("div", dom.element("video")));
      // A shadow root inside a shadow root, like mux-player > mux-video.
      nested = dom.shadowHost("mux-player", dom.shadowHost("mux-video", dom.element("video")));
      dom.body.append(existing, nested);
    }
  });
  const nestedRoot = nested.shadowRoot.childNodes[0].shadowRoot;

  response = await shadow.send({ action: "getState" });
  assert.equal(response.state.videosCount, 3, "videos in open shadow roots are counted");
  assert.equal(shadow.shadowFilter(existing.shadowRoot), "none", "neutral settings emit no rule in shadow roots");
  assert.equal(shadow.shadowFilter(nested.shadowRoot), "unstyled", "shadow roots without videos are left alone");

  response = await shadow.send({ action: "setFilters", filters: { brightness: 130 } });
  assert.match(shadow.filter(), /brightness\(130%\)/);
  assert.match(shadow.shadowFilter(existing.shadowRoot), /brightness\(130%\)/);
  assert.match(shadow.shadowFilter(nestedRoot), /brightness\(130%\)/, "nested shadow roots are reached");
  assert.equal(response.state.videosCount, 3);

  // Players added later are found from the mutation alone, not from a whole-document scan.
  for (let index = 0; index < 300; index += 1) {
    shadow.dom.body.appendChild(shadow.dom.element("div", shadow.dom.element("span")));
  }
  await settle();
  shadow.dom.stats.visited = 0;
  const added = shadow.dom.shadowHost("shreddit-player", shadow.dom.element("video"));
  shadow.dom.body.appendChild(added);
  await settle();
  assert.match(shadow.shadowFilter(added.shadowRoot), /brightness\(130%\)/, "players added later are filtered");
  assert.ok(shadow.dom.stats.visited < 10, `a mutation walks only the added nodes (visited ${shadow.dom.stats.visited})`);

  // A video that appears later inside a shadow root that is already watched.
  const lazy = shadow.dom.shadowHost("media-controller");
  shadow.dom.body.appendChild(lazy);
  await settle();
  assert.equal(shadow.shadowFilter(lazy.shadowRoot), "unstyled");
  lazy.shadowRoot.appendChild(shadow.dom.element("div", shadow.dom.element("video")));
  await settle();
  assert.match(shadow.shadowFilter(lazy.shadowRoot), /brightness\(130%\)/, "videos added inside a watched root are filtered");

  // A custom element inserted before its definition loads attaches its shadow root later, which
  // no mutation record reports.
  const upgraded = shadow.dom.element("shreddit-player");
  shadow.dom.body.appendChild(upgraded);
  await settle();
  upgraded.defined = true;
  upgraded.attachShadow().appendChild(shadow.dom.element("video"));
  await delay(700);
  assert.match(shadow.shadowFilter(upgraded.shadowRoot), /brightness\(130%\)/, "late-upgraded players are filtered");

  // A player script that mounts into a placeholder <div> the parser inserted earlier.
  const placeholder = shadow.dom.element("div");
  shadow.dom.body.appendChild(placeholder);
  await settle();
  placeholder.attachShadow().appendChild(shadow.dom.element("video"));
  await delay(700);
  assert.equal(shadow.shadowFilter(placeholder.shadowRoot), "unstyled", "no mutation record reports a late attachShadow");
  shadow.fire("DOMContentLoaded");
  assert.match(shadow.shadowFilter(placeholder.shadowRoot), /brightness\(130%\)/, "the post-parse rescan finds it");

  response = await shadow.send({ action: "getState" });
  assert.equal(response.state.videosCount, 7);

  const roots = [existing.shadowRoot, nestedRoot, added.shadowRoot, lazy.shadowRoot, upgraded.shadowRoot, placeholder.shadowRoot];
  await shadow.send({ action: "setFilters", filters: { brightness: 100 } });
  assert.equal(shadow.filter(), "none");
  for (const root of roots) {
    assert.equal(shadow.shadowFilter(root), "none", "neutral settings clear shadow roots too");
  }

  // A page that replaces a root's adoptedStyleSheets gets the sheet back on the next change.
  existing.shadowRoot.adoptedStyleSheets = [];
  await shadow.send({ action: "setFilters", filters: { brightness: 110 } });
  assert.match(shadow.shadowFilter(existing.shadowRoot), /brightness\(110%\)/);
  assert.equal(existing.shadowRoot.adoptedStyleSheets.length, 1, "the sheet is adopted once");

  added.remove();
  response = await shadow.send({ action: "getState" });
  assert.equal(response.state.videosCount, 6, "removed players drop out of the count");
}

const domainReload = await createHarness({
  href: "https://example.com/other",
  store: base.store
});
assert.match(domainReload.filter(), /brightness\(145%\)/);

const quick = await createHarness({
  href: "https://video.test/watch?episode=1",
  store: {}
});
await quick.send({
  action: "savePreset",
  slot: 1,
  filters: { brightness: 120, contrast: 100, saturation: 100, warmth: 0 }
});
await delay();
await quick.send({
  action: "savePreset",
  slot: 2,
  filters: { brightness: 180, contrast: 100, saturation: 100, warmth: 0 }
});
assert.equal(quick.store[presetKey("video.test", 1)].filters.brightness, 120);
assert.equal(quick.store[presetKey("video.test", 2)].filters.brightness, 180);
assert.match(quick.filter(), /brightness\(180%\)/);

const sameDomainReload = await createHarness({
  href: "https://video.test/watch?episode=2",
  store: quick.store
});
assert.match(sameDomainReload.filter(), /brightness\(180%\)/);

await delay();
response = await sameDomainReload.send({ action: "applyPreset", slot: 1 });
assert.equal(response.ok, true);
assert.match(sameDomainReload.filter(), /brightness\(120%\)/);
assert.equal(response.state.activePreset.slot, 1);

const selectedReload = await createHarness({
  href: "https://video.test/watch?episode=99",
  store: quick.store
});
assert.match(selectedReload.filter(), /brightness\(120%\)/);

response = await selectedReload.send({ action: "clearPreset", slot: 1 });
assert.equal(response.ok, true);
assert.equal(selectedReload.store[presetKey("video.test", 1)], undefined);
assert.equal(selectedReload.store[presetKey("video.test", 2)].filters.brightness, 180);
assert.match(selectedReload.filter(), /brightness\(180%\)/);

response = await selectedReload.send({ action: "clearPreset", slot: 2 });
assert.equal(response.ok, true);
assert.equal(selectedReload.store[presetKey("video.test", 2)], undefined);
assert.equal(selectedReload.filter(), "none");

// Legacy v1/v2 data kept every preset inside one item; it must still load and then migrate.
const legacyStore = {
  [STORAGE_KEY]: {
    version: 1,
    autoApply: true,
    defaultScope: "domain",
    defaultFilters: {
      brightness: 100,
      contrast: 100,
      saturation: 100,
      warmth: 0
    },
    presets: {
      "domain:legacy.test": {
        scope: "domain",
        label: "legacy.test",
        filters: { brightness: 130, contrast: 100, saturation: 100, warmth: 0 },
        hostname: "legacy.test",
        updatedAt: 100
      },
      "url:https://legacy.test/watch?episode=1": {
        scope: "url",
        label: "https://legacy.test/watch?episode=1",
        filters: { brightness: 170, contrast: 100, saturation: 100, warmth: 0 },
        href: "https://legacy.test/watch?episode=1",
        hostname: "legacy.test",
        updatedAt: 200
      },
      "url:https://legacy.test/watch?episode=2": {
        scope: "url",
        label: "https://legacy.test/watch?episode=2",
        filters: { brightness: 190, contrast: 100, saturation: 100, warmth: 0 },
        href: "https://legacy.test/watch?episode=2",
        hostname: "legacy.test",
        updatedAt: 300
      },
      "url:https://legacy.test/watch?episode=3": {
        scope: "url",
        label: "https://legacy.test/watch?episode=3",
        filters: { brightness: 210, contrast: 100, saturation: 100, warmth: 0 },
        href: "https://legacy.test/watch?episode=3",
        hostname: "legacy.test",
        updatedAt: 400
      }
    }
  }
};

const legacySnapshot = clone(legacyStore);
const legacy = await createHarness({
  href: "https://legacy.test/watch?episode=4",
  store: legacyStore
});
response = await legacy.send({ action: "getState" });
assert.equal(response.ok, true);
assert.equal(response.state.domainPresets.length, 3);
assert.deepEqual(Array.from(response.state.domainPresets, (preset) => preset.slot), [1, 2, 3]);
assert.match(legacy.filter(), /brightness\(210%\)/);

response = await legacy.send({
  action: "savePreset",
  slot: 3,
  filters: { brightness: 160, contrast: 100, saturation: 100, warmth: 0 }
});
assert.equal(response.ok, true);
assert.equal(legacy.store[STORAGE_KEY].presets, undefined, "legacy presets moved out of the settings item");
assert.equal(legacy.store[STORAGE_KEY].version, 3);
const legacyPresetKeys = Object.keys(legacy.store).filter((key) => key.startsWith(PRESET_KEY_PREFIX));
assert.equal(legacyPresetKeys.length, 3);
assert.ok(legacyPresetKeys.every((key) => key.startsWith(`${PRESET_KEY_PREFIX}legacy.test:`)));
assert.equal(legacy.store[presetKey("legacy.test", 3)].filters.brightness, 160);

const migrated = vm.createContext({ chrome: createChrome(legacySnapshot), URL });
vm.runInContext(stateSource, migrated, { filename: "src/state.js" });
assert.equal(await vm.runInContext("VideoTheaterStore.migrateLegacyState()", migrated), true);
const migratedStore = await migrated.chrome.storage.sync.get(null);
assert.equal(migratedStore[STORAGE_KEY].presets, undefined);
assert.equal(Object.keys(migratedStore).filter((key) => key.startsWith(PRESET_KEY_PREFIX)).length, 3);
assert.equal(await vm.runInContext("VideoTheaterStore.migrateLegacyState()", migrated), false, "migration runs once");

const fresh = vm.createContext({ chrome: createChrome({}), URL });
vm.runInContext(stateSource, fresh, { filename: "src/state.js" });
assert.equal(await vm.runInContext("VideoTheaterStore.migrateLegacyState()", fresh), false);
assert.deepEqual(await fresh.chrome.storage.sync.get(null), {}, "a fresh install writes nothing");

response = await sameDomainReload.send({ action: "resetAll" });
assert.equal(response.ok, true);
assert.equal(sameDomainReload.filter(), "none");
assert.deepEqual(Object.keys(sameDomainReload.store).filter((key) => key.startsWith(PRESET_KEY_PREFIX)), []);

// The old single-item layout failed every write after ~20 presets (8 KB per-item sync quota).
const busy = await createHarness({ href: "https://site0.example/", store: {} });
for (let index = 0; index < 60; index += 1) {
  busy.context.location.href = `https://www.very-long-streaming-hostname-${index}.example/watch?v=${index}`;
  response = await busy.send({
    action: "savePreset",
    slot: (index % 3) + 1,
    filters: { brightness: 101 + index, contrast: 100, saturation: 100, warmth: 0 }
  });
  assert.equal(response.ok, true, `preset ${index} saved`);
}
assert.equal(Object.keys(busy.store).filter((key) => key.startsWith(PRESET_KEY_PREFIX)).length, 60);
response = await busy.send({ action: "applyPreset", slot: 3 });
assert.equal(response.ok, true, "selecting a preset still writes after many saves");

// Listeners must exist even if the first storage read fails, or the popup can never connect.
const brokenStorage = await createHarness({ href: "https://broken.test/", failGet: true });
response = await brokenStorage.send({ action: "getState" });
assert.equal(response.ok, false);
assert.match(response.error, /storage unavailable/);

// Re-injection from the popup must not stack a second live instance...
let reinjectedPlayer;
const reinjected = await createHarness({
  href: "https://example.com/",
  store: base.store,
  setup(dom) {
    reinjectedPlayer = dom.shadowHost("shreddit-player", dom.element("video"));
    dom.body.appendChild(reinjectedPlayer);
  }
});
reinjected.inject();
await settle();
assert.equal(reinjected.chrome.messageListeners.length, 1, "live instance is not duplicated");
assert.match(reinjected.shadowFilter(reinjectedPlayer.shadowRoot), /brightness\(145%\)/);
// ...but must replace an instance orphaned by an extension update or reload.
const orphanedRuntime = reinjected.chrome.runtime;
reinjected.context.chrome = createChrome(reinjected.store);
orphanedRuntime.id = undefined;
reinjected.inject();
await settle();
assert.equal(reinjected.context.chrome.messageListeners.length, 1, "orphaned instance is replaced");
assert.match(reinjected.filter(), /brightness\(145%\)/);
assert.equal(reinjectedPlayer.shadowRoot.adoptedStyleSheets.length, 1, "the replacement reuses the adopted sheet");
await new Promise((resolve) => {
  reinjected.context.chrome.messageListeners[0](
    { type: "video-theater", action: "setFilters", filters: { brightness: 100 } },
    {},
    resolve
  );
});
assert.equal(reinjected.shadowFilter(reinjectedPlayer.shadowRoot), "none", "the replacement can clear the old filter");
reinjected.dom.body.appendChild(reinjected.dom.element("div"));
await settle();
assert.equal(reinjected.dom.observers.size, 1, "the replaced instance stops observing");

// Embedded players follow the presets of the page that hosts them.
let embeddedPlayer;
const embedded = await createHarness({
  href: "https://www.youtube.com/embed/abc",
  store: base.store,
  topFrame: false,
  ancestorOrigins: ["https://example.com"],
  setup(dom) {
    embeddedPlayer = dom.shadowHost("media-controller", dom.element("video"));
    dom.body.appendChild(embeddedPlayer);
  }
});
assert.match(embedded.filter(), /brightness\(145%\)/);
assert.match(embedded.shadowFilter(embeddedPlayer.shadowRoot), /brightness\(145%\)/);
assert.equal(await embedded.send({ action: "setFilters", filters: { brightness: 90 } }), undefined, "child frames do not reply");
assert.match(embedded.filter(), /brightness\(90%\)/);
assert.match(embedded.shadowFilter(embeddedPlayer.shadowRoot), /brightness\(90%\)/);

// Embedded players report their videos to the popup so it does not read "0 videos".
assert.equal(await embedded.send({ action: "reportVideos" }), undefined);
assert.deepEqual(embedded.chrome.sentMessages, [{ type: "video-theater", action: "frameVideos", videosCount: 2 }]);
const emptyFrame = await createHarness({
  href: "https://ads.example/frame",
  videos: 0,
  topFrame: false,
  ancestorOrigins: ["https://example.com"]
});
await emptyFrame.send({ action: "reportVideos" });
assert.deepEqual(emptyFrame.chrome.sentMessages, [], "frames without videos stay quiet");

assert.deepEqual(manifest.content_scripts[0].js, ["src/state.js", "src/content.js"]);
assert.ok(manifest.permissions.includes("scripting"), "popup can inject into tabs opened before install");

// Popup: report link and connection recovery.
function createPopupContext({ tab = { id: 7, url: "https://example.com/" }, sendMessage, executeScript, fileAccess = true } = {}) {
  const calls = { sendMessage: [], executeScript: [] };
  const elements = new Map();
  const context = vm.createContext({
    chrome: {
      runtime: {
        getManifest() {
          return { version: "0.1.1", content_scripts: manifest.content_scripts };
        },
        onMessage: {
          addListener() {}
        }
      },
      tabs: {
        async query() {
          return tab ? [tab] : [];
        },
        async sendMessage(...args) {
          calls.sendMessage.push(args);
          return sendMessage(...args);
        }
      },
      scripting: {
        async executeScript(options) {
          calls.executeScript.push(options);
          return executeScript(options);
        }
      },
      extension: {
        async isAllowedFileSchemeAccess() {
          return fileAccess;
        }
      }
    },
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, { id, textContent: "" });
        }
        return elements.get(id);
      }
    },
    navigator: {
      userAgent: "Video Theater test browser"
    },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams
  });
  vm.runInContext(popupSource, context, { filename: "popup/popup.js" });
  return { context, calls, elements };
}

const noReceiver = () => Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
const okState = { ok: true, state: { filters: {}, domainLabel: "example.com" } };

const popup = createPopupContext({ sendMessage: noReceiver, executeScript: async () => [] });
const reportUrl = new URL(vm.runInContext('buildIssueUrl("example.com")', popup.context));
assert.equal(reportUrl.origin, "https://github.com");
assert.equal(reportUrl.pathname, "/Tokenyet/video_theater/issues/new");
assert.equal(reportUrl.searchParams.get("title"), "[Bug] ");
assert.match(reportUrl.searchParams.get("body"), /Extension version: 0\.1\.1/);
assert.match(reportUrl.searchParams.get("body"), /Browser: Video Theater test browser/);
assert.match(reportUrl.searchParams.get("body"), /Website hostname: example\.com/);
assert.doesNotMatch(reportUrl.searchParams.get("body"), /https:\/\/example\.com/);

{
  let injected = false;
  const { context, calls } = createPopupContext({
    sendMessage: () => (injected ? Promise.resolve(okState) : noReceiver()),
    executeScript: async () => {
      injected = true;
      return [];
    }
  });
  const result = await vm.runInContext("connectToActiveTab()", context);
  assert.equal(result.ok, true, "popup recovers a tab that was open before install/update");
  assert.equal(calls.executeScript.length, 1);
  assert.deepEqual(Array.from(calls.executeScript[0].files), ["src/state.js", "src/content.js"]);
  assert.equal(calls.executeScript[0].target.allFrames, true);
  assert.equal(calls.sendMessage[0][2].frameId, 0, "connection check talks to the top frame");
}

{
  const { context, calls } = createPopupContext({
    sendMessage: async () => okState,
    executeScript: async () => assert.fail("no injection when the content script answers")
  });
  assert.equal((await vm.runInContext("connectToActiveTab()", context)).ok, true);
  assert.equal(calls.executeScript.length, 0);
}

// Videos in embedded frames are added to the top frame's count.
{
  const { context, calls, elements } = createPopupContext({
    sendMessage: async () => okState,
    executeScript: async () => []
  });
  await vm.runInContext("connectToActiveTab()", context);
  vm.runInContext("lastState = { videosCount: 1 }; renderVideoCount(lastState); requestFrameVideos();", context);
  assert.equal(elements.get("video-count").textContent, "1 video element(s) found.");
  const broadcast = calls.sendMessage.at(-1);
  assert.equal(broadcast[1].action, "reportVideos");
  assert.equal(broadcast[2], undefined, "the count request reaches every frame");

  const report = (videosCount, sender) => vm.runInContext("handleFrameVideos", context)(
    { type: "video-theater", action: "frameVideos", videosCount },
    sender
  );
  report(2, { tab: { id: 7 }, frameId: 4 });
  assert.equal(elements.get("video-count").textContent, "3 video element(s) found.");
  report(2, { tab: { id: 7 }, frameId: 4 });
  report(5, { tab: { id: 8 }, frameId: 2 });
  report(5, { tab: { id: 7 }, frameId: 0 });
  assert.equal(elements.get("video-count").textContent, "3 video element(s) found.", "repeats and other tabs are ignored");
  report(1, { tab: { id: 7 }, frameId: 9 });
  assert.equal(elements.get("video-count").textContent, "4 video element(s) found.");
  vm.runInContext("renderVideoCount({ videosCount: 0 })", context);
  assert.equal(elements.get("video-count").textContent, "3 video element(s) found.", "frame counts survive a state re-render");
}

{
  const { context } = createPopupContext({
    tab: { id: 3, url: "chrome://settings/" },
    sendMessage: noReceiver,
    executeScript: async () => {
      throw new Error("Cannot access a chrome:// URL");
    }
  });
  const error = await vm.runInContext("connectToActiveTab()", context).catch((caught) => caught);
  assert.equal(error.messageKey, "unsupportedPage");
  assert.equal(error.retryable, false);
}

for (const url of ["https://chromewebstore.google.com/detail/abc", "chrome-extension://abc/page.html"]) {
  const { context } = createPopupContext({
    tab: { id: 5, url },
    sendMessage: noReceiver,
    executeScript: async () => {
      throw new Error("The extensions gallery cannot be scripted.");
    }
  });
  const error = await vm.runInContext("connectToActiveTab()", context).catch((caught) => caught);
  assert.equal(error.messageKey, "unsupportedPage", url);
}

{
  const { context } = createPopupContext({
    tab: { id: 6, url: "https://example.com/watch" },
    sendMessage: noReceiver,
    executeScript: async () => {
      throw new Error("Frame with ID 0 was removed.");
    }
  });
  const error = await vm.runInContext("connectToActiveTab()", context).catch((caught) => caught);
  assert.equal(error.messageKey, "pageNotResponding", "a normal page that refuses injection can be retried");
  assert.equal(error.retryable, true);
}

{
  const { context } = createPopupContext({
    tab: { id: 4, url: "file:///C:/videos/clip.mp4" },
    fileAccess: false,
    sendMessage: noReceiver,
    executeScript: async () => {
      throw new Error("Cannot access contents of url");
    }
  });
  const error = await vm.runInContext("connectToActiveTab()", context).catch((caught) => caught);
  assert.equal(error.messageKey, "fileAccessRequired");
}

{
  const { context } = createPopupContext({
    sendMessage: () => new Promise(() => {}),
    executeScript: async () => assert.fail("a busy page already has the content script")
  });
  const started = Date.now();
  const error = await vm.runInContext("connectToActiveTab()", context).catch((caught) => caught);
  assert.equal(error.messageKey, "pageNotResponding", "a hung page times out instead of leaving the popup stuck");
  assert.equal(error.retryable, true);
  assert.ok(Date.now() - started < 5000);
}

console.log("Smoke tests passed");
