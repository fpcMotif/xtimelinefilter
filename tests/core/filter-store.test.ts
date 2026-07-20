import { describe, expect, it, vi } from "vitest";

import { createFilterStore, normalizeFilterState } from "@/core/filter-store";
import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { installOnChanged } from "../helpers/chrome-fake";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
    await tick(); // same-context storage writes are serialized

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

  it.each([
    ["enabled", { enabled: false }],
    ["criteria", { criteria: { "kind:video": "hide" } }],
    ["onlyMyLanguages", { onlyMyLanguages: true }],
    ["myLanguages", { myLanguages: ["ja"] }],
    ["linkRules", { linkRules: [{ host: "lemmy.world", dest: "reddit" }] }],
  ])("ends reveal for an external %s change", (_field, patch) => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      s.setRevealed(true);
      bridge.emit(STORAGE_KEYS.filter, { ...s.state.value, ...patch });
      expect(s.revealed.value).toBe(false);
    } finally {
      bridge.restore();
    }
  });

  it("keeps reveal for external compact or preset-only changes", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      s.setRevealed(true);
      bridge.emit(STORAGE_KEYS.filter, { ...s.state.value, compactHidden: true });
      expect(s.revealed.value).toBe(true);
      bridge.emit(STORAGE_KEYS.filter, {
        ...s.state.value,
        presets: [
          { id: "p1", name: "Quiet", criteria: {}, onlyMyLanguages: false, myLanguages: ["en"] },
        ],
      });
      expect(s.revealed.value).toBe(true);
    } finally {
      bridge.restore();
    }
  });

  it("ends reveal when an external selection changes without changing its item counts", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      s.setMode("kind:video", "only");
      s.setLinkRules([{ host: "example.com", dest: "reddit" }]);
      s.setRevealed(true);

      bridge.emit(STORAGE_KEYS.filter, {
        ...s.state.value,
        criteria: { "kind:photo": "only" },
        linkRules: [{ host: "example.org", dest: "hn" }],
      });

      expect(s.revealed.value).toBe(false);

      s.setRevealed(true);
      const beforeLinkChange = s.state.value;
      bridge.emit(
        STORAGE_KEYS.filter,
        {
          ...beforeLinkChange,
          linkRules: [{ host: "example.net", dest: "youtube" }],
        },
        "sync",
        beforeLinkChange,
      );
      expect(s.revealed.value).toBe(false);

      s.setRevealed(true);
      const beforeDestinationChange = s.state.value;
      bridge.emit(
        STORAGE_KEYS.filter,
        {
          ...beforeDestinationChange,
          linkRules: [{ host: "example.net", dest: "mastodon" }],
        },
        "sync",
        beforeDestinationChange,
      );
      expect(s.revealed.value).toBe(false);
    } finally {
      bridge.restore();
    }
  });

  it("ends reveal for an external link rule that changes only its destination", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      // Seed state.value so the incoming change shares its host — this forces
      // selectionChanged past the host comparison into the destination check.
      s.setLinkRules([{ host: "example.com", dest: "reddit" }]);
      s.setRevealed(true);
      const before = s.state.value;
      bridge.emit(
        STORAGE_KEYS.filter,
        { ...before, linkRules: [{ host: "example.com", dest: "hn" }] },
        "sync",
        before,
      );
      expect(s.revealed.value).toBe(false);
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
      bridge.emit(STORAGE_KEYS.filter, undefined, "sync", s.state.value);
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
    expect(a.state.value).toEqual(snapshot);
    // Persisted: a fresh store loads the restored config.
    await tick();
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
    expect(s.state.value).toEqual(snapshot);
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

  it("restores the signal after one failed optimistic write", async () => {
    let rejectWrite!: (reason: Error) => void;
    const write = new Promise<void>((_, reject) => {
      rejectWrite = reject;
    });
    const storage: StorageLike = {
      get: async () => ({}),
      set: () => write,
    };
    const s = createFilterStore({ storage, navLanguages: ["en"] });
    const previous = s.state.value;
    s.setEnabled(false);
    rejectWrite(new Error("boom"));
    await tick();
    expect(s.state.value).toEqual(previous);
    expect(s.state.value.enabled).toBe(true);
  });

  it("keeps a newer successful write when an older write fails", async () => {
    let rejectFirst!: (reason: Error) => void;
    let calls = 0;
    const storage: StorageLike = {
      get: async () => ({}),
      set: () => {
        calls += 1;
        if (calls === 1)
          return new Promise<void>((_, reject) => {
            rejectFirst = reject;
          });
        return Promise.resolve();
      },
    };
    const s = createFilterStore({ storage, navLanguages: ["en"] });
    s.setEnabled(false);
    s.setOnlyMyLanguages(true);
    const newer = s.state.value;
    rejectFirst(new Error("old write failed"));
    await tick();
    expect(s.state.value).toBe(newer);
    expect(s.state.value).toMatchObject({ enabled: false, onlyMyLanguages: true });
  });

  it("normalizes persisted Filter state and strips invalid nested records", () => {
    const defaults = {
      enabled: true,
      criteria: {},
      onlyMyLanguages: false,
      myLanguages: ["en"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    };
    expect(
      normalizeFilterState(
        {
          enabled: "false",
          criteria: { "kind:video": "hide", "kind:photo": "off", unknown: "only" },
          onlyMyLanguages: 1,
          myLanguages: ["ja-JP", 4, "EN", ""],
          linkRules: [
            { host: "lemmy.world", dest: "reddit", extra: true },
            { host: "bad.example", dest: "unknown" },
          ],
          presets: [
            {
              id: "p1",
              name: "Quiet",
              criteria: { "kind:video": "only", unknown: "hide" },
              onlyMyLanguages: true,
              myLanguages: ["fr-FR", 1],
              extra: true,
            },
            { id: 1, name: "bad", criteria: {}, onlyMyLanguages: false },
          ],
          compactHidden: "yes",
          extra: true,
        },
        defaults,
      ),
    ).toEqual({
      enabled: true,
      criteria: { "kind:video": "hide" },
      onlyMyLanguages: false,
      myLanguages: ["ja", "en"],
      linkRules: [{ host: "lemmy.world", dest: "reddit" }],
      presets: [
        {
          id: "p1",
          name: "Quiet",
          criteria: { "kind:video": "only" },
          onlyMyLanguages: true,
          myLanguages: ["fr"],
        },
      ],
      compactHidden: false,
    });
  });

  it("normalizes a non-record filter blob and non-record criteria", () => {
    const defaults = {
      enabled: true,
      criteria: {},
      onlyMyLanguages: false,
      myLanguages: ["en"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    };

    expect(normalizeFilterState(null, defaults)).toEqual(defaults);
    expect(normalizeFilterState({ criteria: null }, defaults).criteria).toEqual({});
  });

  it("normalizes corrupt hydrate and failed-write cache adoption", async () => {
    const corrupt = {
      enabled: "no",
      criteria: { "kind:video": "hide", invalid: "only" },
      onlyMyLanguages: "yes",
      myLanguages: ["ja-JP", 1],
      linkRules: [{ host: "bad.example", dest: "invalid" }],
      presets: [{ id: "bad", name: "Bad", criteria: [], onlyMyLanguages: false }],
      compactHidden: 1,
      extra: true,
    };
    const storage: StorageLike = {
      get: async () => ({ [STORAGE_KEYS.filter]: corrupt }),
      set: () => Promise.reject(new Error("boom")),
    };
    const s = createFilterStore({ storage, navLanguages: ["en"] });
    await s.load();
    expect(s.state.value).toEqual({
      enabled: true,
      criteria: { "kind:video": "hide" },
      onlyMyLanguages: false,
      myLanguages: ["ja"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    });

    s.setEnabled(false);
    await tick();
    expect(s.state.value).toEqual({
      enabled: true,
      criteria: { "kind:video": "hide" },
      onlyMyLanguages: false,
      myLanguages: ["ja"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    });
  });

  it("normalizes corrupt external changes and stops them after dispose", () => {
    const bridge = installOnChanged();
    try {
      const s = createFilterStore({ navLanguages: ["en"] });
      bridge.emit(STORAGE_KEYS.filter, {
        enabled: false,
        criteria: { "kind:video": "only", unknown: "hide" },
        onlyMyLanguages: true,
        myLanguages: ["fr-FR", false],
        linkRules: [{ host: "lobste.rs", dest: "hn", ignored: true }],
        presets: [],
        compactHidden: true,
      });
      expect(s.state.value).toEqual({
        enabled: false,
        criteria: { "kind:video": "only" },
        onlyMyLanguages: true,
        myLanguages: ["fr"],
        linkRules: [{ host: "lobste.rs", dest: "hn" }],
        presets: [],
        compactHidden: true,
      });

      s.dispose();
      s.dispose();
      bridge.emit(STORAGE_KEYS.filter, { enabled: true });
      expect(s.state.value.enabled).toBe(false);
    } finally {
      bridge.restore();
    }
  });

  it("normalizes restore input before persisting it", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.restore({
      enabled: "false",
      criteria: { unknown: "only" },
    } as unknown as typeof s.state.value);
    expect(s.state.value).toEqual({
      enabled: true,
      criteria: {},
      onlyMyLanguages: false,
      myLanguages: ["en"],
      linkRules: [],
      presets: [],
      compactHidden: false,
    });
  });
});
