import { describe, expect, it } from "vitest";

import { createFilterStore } from "@/core/filter-store";
import type { StorageLike } from "@/core/settings";

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
    });
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
