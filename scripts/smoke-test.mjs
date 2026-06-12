import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const STORAGE_KEY = "videoTheaterState";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function delay(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createHarness({ href, videos = 1, store = {} }) {
  const elements = new Map();
  const storageListeners = [];
  let messageListener = null;

  const style = {
    values: {},
    setProperty(name, value) {
      this.values[name] = value;
    }
  };

  const root = {
    style,
    appendChild(node) {
      if (node.id) {
        elements.set(node.id, node);
      }
    }
  };

  const chrome = {
    storage: {
      sync: {
        async get(defaults) {
          if (typeof defaults === "string") {
            return { [defaults]: clone(store[defaults]) };
          }

          const result = {};
          for (const [key, value] of Object.entries(defaults || {})) {
            result[key] = clone(store[key] ?? value);
          }
          return result;
        },
        async set(nextValues) {
          const changes = {};
          for (const [key, value] of Object.entries(nextValues)) {
            changes[key] = {
              oldValue: clone(store[key]),
              newValue: clone(value)
            };
            store[key] = clone(value);
          }
          for (const listener of storageListeners) {
            listener(changes, "sync");
          }
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  const windowObject = {};
  windowObject.top = windowObject;
  windowObject.self = windowObject;

  const context = vm.createContext({
    chrome,
    console,
    document: {
      documentElement: root,
      head: null,
      body: null,
      createElement(tagName) {
        return { tagName, id: "", textContent: "" };
      },
      getElementById(id) {
        return elements.get(id) || null;
      },
      querySelectorAll(selector) {
        return selector === "video" ? Array.from({ length: videos }, () => ({})) : [];
      }
    },
    location: { href },
    MutationObserver: class {
      observe() {}
    },
    URL,
    window: windowObject
  });

  vm.runInContext(source, context, { filename: "src/content.js" });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  async function send(message) {
    assert.ok(messageListener, "content script message listener registered");
    return new Promise((resolve) => {
      messageListener({ type: "video-theater", ...message }, {}, resolve);
    });
  }

  return {
    send,
    store,
    filter() {
      return style.values["--video-theater-filter"];
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
assert.equal(base.store[STORAGE_KEY].presets["domain:example.com:1"].filters.brightness, 145);
assert.equal(response.state.domainPresets.length, 1);
assert.equal(response.state.domainPresets[0].slot, 1);

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
assert.equal(quick.store[STORAGE_KEY].presets["domain:video.test:1"].filters.brightness, 120);
assert.equal(quick.store[STORAGE_KEY].presets["domain:video.test:2"].filters.brightness, 180);
assert.equal(quick.store[STORAGE_KEY].presets["url:https://video.test/watch?episode=1"], undefined);

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
assert.equal(selectedReload.store[STORAGE_KEY].presets["domain:video.test:1"], undefined);
assert.equal(selectedReload.store[STORAGE_KEY].presets["domain:video.test:2"].filters.brightness, 180);
assert.match(selectedReload.filter(), /brightness\(180%\)/);

response = await selectedReload.send({ action: "clearPreset", slot: 2 });
assert.equal(response.ok, true);
assert.equal(selectedReload.store[STORAGE_KEY].presets["domain:video.test:2"], undefined);
assert.equal(selectedReload.filter(), "none");

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
assert.equal(Object.keys(legacy.store[STORAGE_KEY].presets).length, 3);
assert.ok(Object.keys(legacy.store[STORAGE_KEY].presets).every((key) => key.startsWith("domain:legacy.test:")));
assert.equal(legacy.store[STORAGE_KEY].presets["domain:legacy.test:3"].filters.brightness, 160);

response = await sameDomainReload.send({ action: "resetAll" });
assert.equal(response.ok, true);
assert.equal(sameDomainReload.filter(), "none");
assert.deepEqual(sameDomainReload.store[STORAGE_KEY].presets, {});

console.log("Smoke tests passed");
