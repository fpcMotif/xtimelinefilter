import { describe, expect, it, vi } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { installOnChanged } from "../helpers/chrome-fake";

describe("createFilterStore", () => {
  it("cycles a criterion off → only → hide → off", () => {
    const s = createFilterStore({ navLanguages: ["en-US"] });
    expect(s.state.value.criteria["kind:video"]).toBeUndefined();
    s.cycle("kind:video");
    expect(s.state.value.criteria["kind:video"]).toBe("only");
    s.cycle("kind:video");
    expect(s.state.value.criteria["kind:video"]).toBe("hide");
    s.cycle("kind:video");
    expect(s.state.value.criteria["kind:video"]).toBeUndefined();
  });

  it("defaults to a no-op with languages seeded from navLanguages", () => {
    const s = createFilterStore({ navLanguages: ["ja-JP", "en-US"] });
    expect(s.state.value).toEqual({
      enabled: true,
      criteria: {},
      onlyMyLanguages: false,
      myLanguages: ["ja", "en"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    });
  });

  it("round-trips through storage.sync", async () => {
    const a = createFilterStore({ navLanguages: ["en-US"] });
    a.setOnlyMyLanguages(true);
    a.setMyLanguages(["ja-JP", "en"]);
    a.setLinkRules([{ host: "lemmy.world", dest: "reddit" }]);
    a.cycle("kind:video"); // only
    a.cycle("kind:video"); // hide

    const b = createFilterStore({ navLanguages: ["fr"] });
    await b.load();
    expect(b.state.value).toEqual({
      enabled: true,
      criteria: { "kind:video": "hide" },
      onlyMyLanguages: true,
      myLanguages: ["ja", "en"],
      linkRules: [{ host: "lemmy.world", dest: "reddit" }],
      presets: [],
      compactHidden: false,
    });
  });

  it("reveal is transient: any selection edit resumes filtering, and it never persists", async () => {
    const a = createFilterStore({ navLanguages: ["en"] });
    a.setRevealed(true);
    expect(a.revealed.value).toBe(true);
    a.cycle("kind:video"); // editing the selection ends the peek
    expect(a.revealed.value).toBe(false);

    a.setRevealed(true);
    const b = createFilterStore({ navLanguages: ["en"] });
    await b.load();
    expect(b.revealed.value).toBe(false); // not written to storage.sync
  });

  it("show-all cannot reveal while the filter is disabled (stays coherent)", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.setEnabled(false);
    s.setRevealed(true); // e.g. palette "disable filter" then "show all hidden"
    expect(s.revealed.value).toBe(false);
  });

  it("compactHidden defaults off, persists, and is not a peek (keeps reveal)", async () => {
    const a = createFilterStore({ navLanguages: ["en"] });
    expect(a.state.value.compactHidden).toBe(false);
    a.setRevealed(true);
    a.setCompactHidden(true); // a display pref — must not end the peek
    expect(a.state.value.compactHidden).toBe(true);
    expect(a.revealed.value).toBe(true);

    const b = createFilterStore({ navLanguages: ["fr"] });
    await b.load();
    expect(b.state.value.compactHidden).toBe(true); // synced via storage.sync
  });

  it("adopts an external compactHidden change live via the storage.onChanged bridge", () => {
    // The shared chrome mock has no onChanged (watchStorageKey is a no-op there);
    // install a minimal one so the cross-context bridge can be driven, then restore.
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      expect(s.state.value.compactHidden).toBe(false);
      // Another context (the popup) writes compactHidden: true.
      bridge.emit(STORAGE_KEYS.filter, { compactHidden: true });
      expect(s.state.value.compactHidden).toBe(true);
    } finally {
      bridge.restore();
    }
  });

  it("saves, applies, renames, and deletes presets", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.cycle("kind:video"); // only
    s.setOnlyMyLanguages(true);
    s.setMyLanguages(["ja-JP"]);
    const id = s.savePreset("Quiet");
    expect(s.state.value.presets).toHaveLength(1);
    expect(s.state.value.presets[0]).toMatchObject({
      id,
      name: "Quiet",
      criteria: { "kind:video": "only" },
      onlyMyLanguages: true,
      myLanguages: ["ja"],
    });

    // Mutate away from the snapshot, then apply it back.
    s.setMode("kind:video", "off");
    s.setOnlyMyLanguages(false);
    s.setMyLanguages(["fr"]);
    s.applyPreset(id);
    expect(s.state.value.criteria).toEqual({ "kind:video": "only" });
    expect(s.state.value.onlyMyLanguages).toBe(true);
    expect(s.state.value.myLanguages).toEqual(["ja"]);

    // A second preset proves renamePreset leaves non-matching presets untouched.
    const other = s.savePreset("Other");
    s.renamePreset(id, "Calm");
    const byId = Object.fromEntries(s.state.value.presets.map((p) => [p.id, p.name]));
    expect(byId[id]).toBe("Calm");
    expect(byId[other]).toBe("Other");

    s.deletePreset(id);
    s.deletePreset(other);
    expect(s.state.value.presets).toEqual([]);
  });

  it("seeds myLanguages from navigator.languages when navLanguages is omitted", () => {
    const original = navigator.languages;
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => ["pt-BR", "en-US"],
    });
    try {
      const s = createFilterStore(); // no navLanguages → falls back to navigator.languages
      expect(s.state.value.myLanguages).toEqual(["pt", "en"]);
    } finally {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        get: () => original,
      });
    }
  });

  it("seeds no languages when navigator is unavailable and navLanguages is omitted", () => {
    vi.stubGlobal("navigator", undefined); // typeof navigator === "undefined" → []
    try {
      const s = createFilterStore();
      expect(s.state.value.myLanguages).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the storage bridge ignores the echo of our own write (identical value)", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      s.setEnabled(false); // a local write updates lastSerialized
      const snapshot = s.state.value;
      // The same write echoes back from chrome.storage.onChanged → must be ignored.
      bridge.emit(STORAGE_KEYS.filter, snapshot);
      expect(s.state.value).toBe(snapshot); // identity unchanged: early return hit
    } finally {
      bridge.restore();
    }
  });

  it("applyPreset is a no-op for an unknown id", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.applyPreset("missing"); // early return — no throw, no change
    expect(s.state.value.presets).toEqual([]);
    expect(s.state.value.criteria).toEqual({});
  });

  it("applyPreset without a captured myLanguages leaves the live languages untouched", async () => {
    const storage: StorageLike = {
      get: async () => ({
        [STORAGE_KEYS.filter]: {
          presets: [
            {
              id: "P1",
              name: "Legacy",
              criteria: { "kind:video": "hide" },
              onlyMyLanguages: true,
              // myLanguages intentionally absent (older persisted preset)
            },
          ],
        },
      }),
      set: async () => {},
    };
    const s = createFilterStore({ storage, navLanguages: ["en"] });
    await s.load();
    s.setMyLanguages(["it"]);
    s.applyPreset("P1");
    expect(s.state.value.criteria).toEqual({ "kind:video": "hide" });
    expect(s.state.value.onlyMyLanguages).toBe(true);
    expect(s.state.value.myLanguages).toEqual(["it"]); // not overwritten
  });

  it("the storage bridge resets to defaults when the external value is cleared", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      s.cycle("kind:video");
      expect(s.state.value.criteria["kind:video"]).toBe("only");
      // Another context clears the key (newValue undefined) → reset to defaults.
      bridge.emit(STORAGE_KEYS.filter, undefined);
      expect(s.state.value.criteria).toEqual({});
    } finally {
      bridge.restore();
    }
  });

  it("restore replaces the whole state and persists it (powers conducted undo)", async () => {
    const a = createFilterStore({ navLanguages: ["en"] });
    a.cycle("kind:video"); // only
    const snapshot = a.state.value;
    a.cycle("kind:video"); // hide — moves away from the snapshot
    a.restore(snapshot);
    expect(a.state.value).toBe(snapshot);
    // Persisted: a fresh store loads the restored config.
    const b = createFilterStore({ navLanguages: ["fr"] });
    await b.load();
    expect(b.state.value.criteria["kind:video"]).toBe("only");
  });

  it("restore ends a 'show all' peek, like every other selection edit (undo must be visible)", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.cycle("kind:video"); // the command undo will revert
    const snapshot = s.state.value;
    s.cycle("kind:video");
    s.setRevealed(true); // transient peek — doesn't change state, doesn't re-arm undo
    s.restore(snapshot); // Z
    expect(s.revealed.value).toBe(false); // …or the timeline would visibly not change
    expect(s.state.value).toBe(snapshot);
  });

  it("falls back to safe defaults when storage rejects, never throws", async () => {
    const broken: StorageLike = {
      get: () => Promise.reject(new Error("boom")),
      set: () => Promise.reject(new Error("boom")),
    };
    const s = createFilterStore({ storage: broken, navLanguages: ["ja"] });
    s.setEnabled(false); // persist rejects internally — must not throw
    await expect(s.load()).resolves.toBeUndefined();
    expect(s.state.value.myLanguages).toEqual(["ja"]);
  });
});
