import { describe, expect, it } from "vitest";

import {
  applyFilterCommand,
  bindingKey,
  defaultFilterState,
  isFilterCommand,
  isFilterState,
  MAX_FILTER_LANGUAGE_LENGTH,
  MAX_FILTER_LINK_RULES,
  MAX_FILTER_PRESETS,
  normalizeFilterState,
  normalizeLangs,
  selectionChanged,
} from "@/core/filter-domain";

/**
 * A scope's binding key (spec #31). Null is a policy answer, not a missing name:
 * Bookmarks is a real Filter scope that cannot yet carry its own preset, so it
 * must key to null rather than to a string a binding could be stored under.
 */
describe("bindingKey", () => {
  it("keys the three bindable scopes", () => {
    expect(bindingKey({ kind: "home" })).toBe("home");
    expect(bindingKey({ kind: "list", listId: "1583920441" })).toBe("list:1583920441");
    expect(bindingKey({ kind: "profile", handle: "jack" })).toBe("profile:jack");
  });

  it("refuses to key Bookmarks, so it cannot be bound", () => {
    expect(bindingKey({ kind: "bookmarks" })).toBeNull();
  });

  it("keys each bindable scope distinctly, so bindings never collide", () => {
    const keys = [
      bindingKey({ kind: "home" }),
      bindingKey({ kind: "list", listId: "1" }),
      bindingKey({ kind: "profile", handle: "1" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("FilterCommand", () => {
  it("applies two cycles at authority, rather than replaying two stale snapshots", () => {
    const defaults = defaultFilterState(["en-US"]);
    const once = applyFilterCommand(defaults, { type: "cycle", id: "kind:video" });
    const twice = applyFilterCommand(once, { type: "cycle", id: "kind:video" });

    expect(twice.criteria).toEqual({ "kind:video": "hide" });
  });

  it("applies a preset atomically without replacing link rules or compact mode", () => {
    const base = {
      ...defaultFilterState(["en"]),
      criteria: { "kind:video": "hide" as const },
      onlyMyLanguages: true,
      linkRules: [{ host: "lemmy.world", dest: "reddit" as const }],
      compactHidden: true,
      presets: [
        {
          id: "reading",
          name: "Reading",
          criteria: { "kind:photo": "only" as const },
          onlyMyLanguages: false,
          myLanguages: ["ja"],
        },
      ],
    };

    expect(applyFilterCommand(base, { type: "apply-preset", id: "reading" })).toMatchObject({
      criteria: { "kind:photo": "only" },
      onlyMyLanguages: false,
      myLanguages: ["ja"],
      linkRules: [{ host: "lemmy.world", dest: "reddit" }],
      compactHidden: true,
    });
  });

  it("rejects unbounded or forged wire commands and snapshots", () => {
    expect(isFilterCommand({ type: "cycle", id: "unknown" })).toBe(false);
    expect(isFilterCommand({ type: "set-my-languages", languages: Array(65).fill("en") })).toBe(
      false,
    );
    expect(isFilterCommand({ type: "set-enabled", on: true, extra: true })).toBe(false);
    expect(isFilterState({ ...defaultFilterState([]), extra: true })).toBe(false);
  });

  it("keeps the preset catalog valid at its exact bound and ignores duplicate ids", () => {
    const full = defaultFilterState(["en"]);
    full.presets = Array.from({ length: MAX_FILTER_PRESETS }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      criteria: {},
      onlyMyLanguages: false,
    }));

    const capped = applyFilterCommand(full, { type: "save-preset", id: "next", name: "Next" });
    expect(capped).toBe(full);
    expect(capped.presets).toHaveLength(MAX_FILTER_PRESETS);
    expect(isFilterState(capped)).toBe(true);

    const duplicate = applyFilterCommand(defaultFilterState(["en"]), {
      type: "save-preset",
      id: "same",
      name: "First",
    });
    expect(applyFilterCommand(duplicate, { type: "save-preset", id: "same", name: "Again" })).toBe(
      duplicate,
    );
  });

  it("normalizes storage blobs at bounds without accepting malformed nested values", () => {
    const defaults = defaultFilterState(["en"]);
    const long = "x".repeat(MAX_FILTER_LANGUAGE_LENGTH + 1);
    const rules = Array.from({ length: MAX_FILTER_LINK_RULES + 1 }, (_, index) => ({
      host: `host-${index}.example`,
      dest: "article" as const,
    }));

    expect(normalizeLangs([" EN-us ", "en", "", long])).toEqual(["en"]);
    expect(normalizeLangs(Array.from({ length: 65 }, (_, index) => `lang${index}`))).toHaveLength(
      64,
    );
    expect(
      normalizeFilterState(
        {
          criteria: "corrupt",
          myLanguages: ["fr-FR", 1, long],
          linkRules: [...rules, { host: 1, dest: "article" }],
          presets: [
            { id: "bad", name: "Bad", criteria: {}, onlyMyLanguages: "yes" },
            {
              id: "keep",
              name: "Keep",
              criteria: { "kind:video": "only" },
              onlyMyLanguages: true,
            },
          ],
        },
        defaults,
      ),
    ).toMatchObject({
      criteria: {},
      myLanguages: ["fr"],
      linkRules: rules.slice(0, MAX_FILTER_LINK_RULES),
      presets: [
        {
          id: "keep",
          name: "Keep",
          criteria: { "kind:video": "only" },
          onlyMyLanguages: true,
        },
      ],
    });
  });

  it("accepts every semantic filter command shape and rejects extra or malformed fields", () => {
    const state = {
      ...defaultFilterState(["en"]),
      criteria: { "kind:video": "hide" as const },
      linkRules: [{ host: "example.com", dest: "article" as const }],
      presets: [
        {
          id: "p",
          name: "Preset",
          criteria: { "kind:photo": "only" as const },
          onlyMyLanguages: false,
          myLanguages: ["en"],
        },
      ],
    };
    const commands = [
      { type: "cycle", id: "kind:video" },
      { type: "set-mode", id: "kind:video", mode: "off" },
      { type: "set-only-my-languages", on: true },
      { type: "set-my-languages", languages: ["en"] },
      { type: "set-link-rules", rules: state.linkRules },
      { type: "set-enabled", on: false },
      { type: "set-compact-hidden", on: true },
      { type: "save-preset", id: "next", name: "Next" },
      { type: "apply-preset", id: "p" },
      { type: "rename-preset", id: "p", name: "Renamed" },
      { type: "delete-preset", id: "p" },
      { type: "restore", state },
    ];

    for (const command of commands) expect(isFilterCommand(command)).toBe(true);
    expect(isFilterState(state)).toBe(true);
    expect(isFilterCommand(null)).toBe(false);
    expect(isFilterCommand({ type: "unknown" })).toBe(false);
    expect(isFilterCommand({ type: "set-mode", id: "kind:video", mode: "bad" })).toBe(false);
    expect(isFilterCommand({ type: "set-link-rules", rules: [{ host: "x", dest: "bad" }] })).toBe(
      false,
    );
    expect(isFilterCommand({ type: "apply-preset", id: "p", extra: true })).toBe(false);
    expect(isFilterCommand({ type: "restore", state: { ...state, compactHidden: "no" } })).toBe(
      false,
    );
    expect(
      isFilterState({ ...state, linkRules: [{ host: "x", dest: "article", extra: true }] }),
    ).toBe(false);
  });

  it("treats equivalent selection data as stable but detects each selection surface", () => {
    const base = defaultFilterState(["en"]);
    expect(
      selectionChanged(base, {
        ...base,
        presets: [{ id: "p", name: "P", criteria: {}, onlyMyLanguages: false }],
      }),
    ).toBe(false);
    expect(selectionChanged(base, { ...base, enabled: false })).toBe(true);
    expect(selectionChanged(base, { ...base, criteria: { "kind:video": "only" } })).toBe(true);
    expect(selectionChanged(base, { ...base, myLanguages: ["fr"] })).toBe(true);
    expect(selectionChanged(base, { ...base, linkRules: [{ host: "x", dest: "article" }] })).toBe(
      true,
    );
  });

  it("applies every state mutation without mutating caller-owned rules or preset snapshots", () => {
    const base = defaultFilterState(["en"]);
    const rules = [{ host: "example.com", dest: "article" as const }];
    const withRules = applyFilterCommand(base, { type: "set-link-rules", rules });
    rules[0]!.host = "changed.example";
    const enabled = applyFilterCommand(withRules, { type: "set-enabled", on: false });
    const compact = applyFilterCommand(enabled, { type: "set-compact-hidden", on: true });
    const saved = applyFilterCommand(compact, { type: "save-preset", id: "p", name: "One" });
    const renamed = applyFilterCommand(saved, { type: "rename-preset", id: "p", name: "Two" });
    const deleted = applyFilterCommand(renamed, { type: "delete-preset", id: "p" });

    expect(withRules.linkRules).toEqual([{ host: "example.com", dest: "article" }]);
    expect(enabled.enabled).toBe(false);
    expect(compact.compactHidden).toBe(true);
    expect(renamed.presets[0]?.name).toBe("Two");
    expect(deleted.presets).toEqual([]);
  });
});
