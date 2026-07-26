import { describe, expect, it } from "vitest";

import { createFilterStore, type FilterStore } from "@/core/filter-store";
import type { StorageLike } from "@/core/settings";

/** In-memory storage double with shared backing, so two stores round-trip deterministically. */
function fakeStorage(): StorageLike {
  let data: Record<string, unknown> = {};
  return {
    get: async (keys) => {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    set: async (items) => {
      data = { ...data, ...items };
    },
    remove: async (keys) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    },
  };
}

/** Save a preset capturing "only <criterion>", then clear the live selection. */
function presetOf(store: FilterStore, criterion: string, name: string): string {
  store.setMode(criterion, "only");
  const id = store.savePreset(name);
  store.setMode(criterion, "off");
  return id;
}

/**
 * Per-scope filter bindings (spec #31). The store is the seam: arriving at a
 * bound scope applies its preset, an unbound scope keeps the one shared
 * selection every scope used before #31, and the binding itself is durable.
 */
describe("filter-store scope bindings", () => {
  it("applies the bound preset on arrival, and leaves an unbound scope alone", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("list:123", links);

    store.enterScope({ kind: "list", listId: "123" });
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });

    // Home was never bound, so arriving there changes nothing — the selection
    // simply stays whatever it currently is, exactly as it did before #31.
    store.enterScope({ kind: "home" });
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });
  });

  it("carries a different preset per scope", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    const text = presetOf(store, "kind:text", "Text only");
    store.bindScope("list:123", links);
    store.bindScope("profile:jack", text);

    store.enterScope({ kind: "list", listId: "123" });
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });

    store.enterScope({ kind: "profile", handle: "jack" });
    expect(store.state.value.criteria).toEqual({ "kind:text": "only" });
  });

  it("discards live drift when you return to a bound scope", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("home", links);

    store.enterScope({ kind: "home" });
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });

    // Editing on a bound scope is live-only: the binding still names the preset,
    // and the preset itself is untouched.
    store.setMode("kind:video", "hide");
    expect(store.state.value.criteria).toEqual({ "kind:link": "only", "kind:video": "hide" });
    expect(store.state.value.scopeBindings).toEqual({ home: links });
    expect(store.state.value.presets[0]?.criteria).toEqual({ "kind:link": "only" });

    // Leaving and returning reapplies the binding, discarding the drift.
    store.enterScope({ kind: "profile", handle: "someone" });
    store.enterScope({ kind: "home" });
    expect(store.state.value.criteria).toEqual({ "kind:link": "only" });
  });

  it("ignores arrival at a scope that cannot be bound, or at no scope at all", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("home", links);
    store.setMode("kind:photo", "hide");
    const before = store.state.value;

    store.enterScope({ kind: "bookmarks" }); // in Filter scope, but not bindable
    store.enterScope(null); // off a Filter timeline entirely
    expect(store.state.value).toBe(before);
  });

  it("does not rewrite storage when the bound preset is already what is showing", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("home", links);

    store.enterScope({ kind: "home" });
    const applied = store.state.value;

    // Re-arriving is a no-op: x.com is a SPA and fires route changes constantly,
    // so a redundant write here would burn the sync quota on every navigation.
    store.enterScope({ kind: "home" });
    expect(store.state.value).toBe(applied);
  });

  it("falls a scope back to the shared selection when its preset is deleted", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("home", links);
    store.deletePreset(links);

    expect(store.state.value.scopeBindings).toEqual({});
    store.setMode("kind:photo", "hide");
    store.enterScope({ kind: "home" });
    expect(store.state.value.criteria).toEqual({ "kind:photo": "hide" });
  });

  it("unbinds a scope, after which arriving no longer applies the preset", () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    const links = presetOf(store, "kind:link", "Links only");
    store.bindScope("home", links);
    store.unbindScope("home");
    store.setMode("kind:photo", "hide");

    store.enterScope({ kind: "home" });
    expect(store.state.value.criteria).toEqual({ "kind:photo": "hide" });
  });

  it("persists bindings across a storage round-trip", async () => {
    const storage = fakeStorage();
    const a = createFilterStore({ storage, navLanguages: ["en"] });
    const links = presetOf(a, "kind:link", "Links only");
    a.bindScope("list:123", links);
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); // ordered local writes settle

    const b = createFilterStore({ storage, navLanguages: ["en"] });
    await b.load();
    expect(b.state.value.scopeBindings).toEqual({ "list:123": links });

    b.enterScope({ kind: "list", listId: "123" });
    expect(b.state.value.criteria).toEqual({ "kind:link": "only" });
  });

  it("applies a preset's language gate on arrival, but never the global toggles", async () => {
    const store = createFilterStore({ storage: fakeStorage(), navLanguages: ["en"] });
    store.setOnlyMyLanguages(true);
    store.setMyLanguages(["ja"]);
    const japanese = store.savePreset("Japanese only");
    store.setOnlyMyLanguages(false);
    store.setMyLanguages(["en"]);

    // Each global is moved off its default first, so surviving arrival is a real
    // claim — an assertion against the default would pass even if arrival set it.
    store.setCompactHidden(true);
    store.setEnabled(false);
    store.setLinkRules([{ host: "lemmy.world", dest: "reddit" }]);
    store.bindScope("home", japanese);
    store.enterScope({ kind: "home" });

    expect(store.state.value.onlyMyLanguages).toBe(true);
    expect(store.state.value.myLanguages).toEqual(["ja"]);
    // Global by design: a binding scopes the selection, never these.
    expect(store.state.value.enabled).toBe(false);
    expect(store.state.value.compactHidden).toBe(true);
    expect(store.state.value.linkRules).toEqual([{ host: "lemmy.world", dest: "reddit" }]);
  });
});
