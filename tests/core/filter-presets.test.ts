import { describe, expect, it } from "vitest";

import { createFilterStore } from "@/core/filter-store";
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

describe("filter-store presets", () => {
  it("saves, applies, and persists a named preset (storage.sync round-trip)", async () => {
    const storage = fakeStorage();
    const a = createFilterStore({ storage, navLanguages: ["en-US"] });
    a.setMode("kind:video", "only");
    a.setOnlyMyLanguages(true);

    const id = a.savePreset("Reading");
    expect(id).toBeTruthy();
    expect(a.state.value.presets).toHaveLength(1);

    const [preset] = a.state.value.presets;
    expect(preset).toBeDefined();
    expect(preset!.id).toBe(id);
    expect(preset!.name).toBe("Reading");
    expect(preset!.criteria).toEqual({ "kind:video": "only" });
    expect(preset!.onlyMyLanguages).toBe(true);

    // Clear the active selection, then re-apply the preset.
    a.setMode("kind:video", "off");
    a.setOnlyMyLanguages(false);
    expect(a.state.value.criteria).toEqual({});

    a.applyPreset(id);
    expect(a.state.value.criteria["kind:video"]).toBe("only");
    expect(a.state.value.onlyMyLanguages).toBe(true);

    // A fresh store loading from the same area sees the preset (round-trip).
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); // ordered local writes settle
    const b = createFilterStore({ storage, navLanguages: ["fr"] });
    await b.load();
    expect(b.state.value.presets).toHaveLength(1);
    expect(b.state.value.presets[0]!.name).toBe("Reading");
    expect(b.state.value.presets[0]!.criteria).toEqual({ "kind:video": "only" });
  });

  it("renames a preset, changing only its name", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.setMode("kind:photo", "hide");
    const id = s.savePreset("Reading");

    s.renamePreset(id, "Focus");
    const [preset] = s.state.value.presets;
    expect(preset!.id).toBe(id);
    expect(preset!.name).toBe("Focus");
    expect(preset!.criteria).toEqual({ "kind:photo": "hide" });
  });

  it("deletes a preset", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    const id = s.savePreset("Reading");
    expect(s.state.value.presets).toHaveLength(1);

    s.deletePreset(id);
    expect(s.state.value.presets).toEqual([]);
  });

  it("captures myLanguages when present and leaves linkRules untouched on apply", () => {
    const s = createFilterStore({ navLanguages: ["en-US"] });
    s.setMyLanguages(["ja-JP", "en"]);
    s.setOnlyMyLanguages(true);
    s.setMode("kind:video", "only");
    const id = s.savePreset("Reading");

    const [preset] = s.state.value.presets;
    expect(preset!.myLanguages).toEqual(["ja", "en"]);

    // Now set linkRules and a different selection, then apply the preset.
    s.setLinkRules([{ host: "lemmy.world", dest: "reddit" }]);
    s.setMode("kind:video", "off");
    s.applyPreset(id);

    // applyPreset replaces criteria + onlyMyLanguages (+ myLanguages) but NOT linkRules.
    expect(s.state.value.criteria["kind:video"]).toBe("only");
    expect(s.state.value.onlyMyLanguages).toBe(true);
    expect(s.state.value.myLanguages).toEqual(["ja", "en"]);
    expect(s.state.value.linkRules).toEqual([{ host: "lemmy.world", dest: "reddit" }]);
  });

  it("defaults a missing presets field to [] on load (migration / fail-open)", async () => {
    const storage = fakeStorage();
    // Seed a legacy state with no `presets` key.
    await storage.set({
      "lasso:filter": {
        enabled: true,
        criteria: { "kind:video": "hide" },
        onlyMyLanguages: false,
        myLanguages: ["en"],
        linkRules: [],
      },
    });

    const s = createFilterStore({ storage, navLanguages: ["en"] });
    await s.load();
    expect(s.state.value.presets).toEqual([]);
    expect(s.state.value.criteria).toEqual({ "kind:video": "hide" });
  });

  it("leaves the global compactHidden display preference untouched on save + apply", () => {
    const s = createFilterStore({ navLanguages: ["en"] });
    s.setCompactHidden(true);
    s.setMode("kind:video", "only");
    const id = s.savePreset("Clean");
    // A preset is a selection snapshot — it must not capture the display pref.
    expect("compactHidden" in s.state.value.presets[0]!).toBe(false);

    s.setMode("kind:video", "off");
    s.applyPreset(id);
    expect(s.state.value.criteria["kind:video"]).toBe("only");
    expect(s.state.value.compactHidden).toBe(true); // survives a preset apply
  });
});
