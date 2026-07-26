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
  MAX_FILTER_SCOPE_BINDINGS,
  normalizeFilterState,
  normalizeLangs,
  selectionChanged,
} from "@/core/filter-domain";
import type { FilterState } from "@/core/filter-types";

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

/** Default state carrying one saved preset, "p1", for bindings to point at. */
const withPreset = (): FilterState =>
  applyFilterCommand(defaultFilterState(["en"]), {
    type: "save-preset",
    id: "p1",
    name: "Links only",
  });

/**
 * Scope bindings (spec #31): a scope key points at a preset id. A binding is a
 * pointer, never a second copy of the criteria, so the durable shape stores only
 * the id and every apply goes back through the preset catalog.
 */
describe("scope bindings", () => {
  it("binds a scope to a preset and unbinds it again", () => {
    const bound = applyFilterCommand(withPreset(), {
      type: "bind-scope",
      key: "list:123",
      presetId: "p1",
    });
    expect(bound.scopeBindings).toEqual({ "list:123": "p1" });

    const unbound = applyFilterCommand(bound, { type: "unbind-scope", key: "list:123" });
    expect(unbound.scopeBindings).toEqual({});
  });

  it("refuses to bind a preset that does not exist", () => {
    const state = withPreset();
    const next = applyFilterCommand(state, {
      type: "bind-scope",
      key: "home",
      presetId: "ghost",
    });
    expect(next).toBe(state);
  });

  it("rebinds an existing scope to a different preset", () => {
    const two = applyFilterCommand(withPreset(), {
      type: "save-preset",
      id: "p2",
      name: "Media only",
    });
    const bound = applyFilterCommand(two, { type: "bind-scope", key: "home", presetId: "p1" });
    const rebound = applyFilterCommand(bound, {
      type: "bind-scope",
      key: "home",
      presetId: "p2",
    });
    expect(rebound.scopeBindings).toEqual({ home: "p2" });
  });

  it("leaves state untouched when unbinding a scope that was never bound", () => {
    const state = withPreset();
    expect(applyFilterCommand(state, { type: "unbind-scope", key: "home" })).toBe(state);
  });

  it("drops bindings to a preset when that preset is deleted", () => {
    const bound = applyFilterCommand(withPreset(), {
      type: "bind-scope",
      key: "home",
      presetId: "p1",
    });
    const deleted = applyFilterCommand(bound, { type: "delete-preset", id: "p1" });
    expect(deleted.presets).toEqual([]);
    expect(deleted.scopeBindings).toEqual({});
  });

  it("binding never touches the global toggles or the live selection", () => {
    // Each global is moved off its default first, so "unaffected" is a real
    // claim rather than one a no-op would also satisfy.
    let state = applyFilterCommand(withPreset(), { type: "set-compact-hidden", on: true });
    state = applyFilterCommand(state, { type: "set-enabled", on: false });
    state = applyFilterCommand(state, {
      type: "set-link-rules",
      rules: [{ host: "lobste.rs", dest: "hn" }],
    });
    const bound = applyFilterCommand(state, {
      type: "bind-scope",
      key: "home",
      presetId: "p1",
    });
    expect(bound.enabled).toBe(false);
    expect(bound.compactHidden).toBe(true);
    expect(bound.linkRules).toEqual([{ host: "lobste.rs", dest: "hn" }]);
    expect(bound.criteria).toEqual(state.criteria);
    expect(bound.onlyMyLanguages).toBe(state.onlyMyLanguages);
  });

  /**
   * An unreachable key is worse than a dangling preset id: no navigation can
   * ever resolve to it, and decoding cannot tell it apart from a real one by
   * looking at the preset catalog. So the grammar is the gate, at both the wire
   * and the storage boundary.
   */
  it("rejects scope keys outside the grammar bindingKey produces", () => {
    for (const key of [
      "",
      "garbage",
      "bookmarks", // a real Filter scope, but deliberately not bindable
      "profile:Jack", // un-folded; would shadow the real profile:jack binding
      "profile:has-a-dash",
      "profile:this_handle_is_too_long",
      "list:abc",
      "list:",
      "home:extra",
    ]) {
      expect(isFilterCommand({ type: "bind-scope", key, presetId: "p1" })).toBe(false);
      expect(isFilterCommand({ type: "unbind-scope", key })).toBe(false);
      expect(isFilterState({ ...defaultFilterState([]), scopeBindings: { [key]: "p1" } })).toBe(
        false,
      );
    }
  });

  it("drops storage bindings whose key is outside the grammar", () => {
    const decoded = normalizeFilterState(
      {
        presets: [{ id: "p1", name: "Kept", criteria: {}, onlyMyLanguages: false }],
        scopeBindings: { home: "p1", "profile:Jack": "p1", garbage: "p1", "": "p1" },
      },
      defaultFilterState([]),
    );
    expect(decoded.scopeBindings).toEqual({ home: "p1" });
  });

  it("holds bindings at the cap and refuses to grow past it", () => {
    let state = withPreset();
    for (let i = 0; i < MAX_FILTER_SCOPE_BINDINGS; i++) {
      state = applyFilterCommand(state, {
        type: "bind-scope",
        key: `list:${i}`,
        presetId: "p1",
      });
    }
    expect(Object.keys(state.scopeBindings)).toHaveLength(MAX_FILTER_SCOPE_BINDINGS);

    const overflowed = applyFilterCommand(state, {
      type: "bind-scope",
      key: "home",
      presetId: "p1",
    });
    expect(overflowed).toBe(state);

    // At the cap, replacing an existing key is a swap, not growth — still allowed.
    const swapped = applyFilterCommand(state, {
      type: "bind-scope",
      key: "list:0",
      presetId: "p1",
    });
    expect(Object.keys(swapped.scopeBindings)).toHaveLength(MAX_FILTER_SCOPE_BINDINGS);
  });

  it("decodes bindings from storage, dropping ones whose preset is gone", () => {
    const decoded = normalizeFilterState(
      {
        presets: [{ id: "p1", name: "Kept", criteria: {}, onlyMyLanguages: false }],
        scopeBindings: {
          home: "p1",
          "list:9": "vanished", // preset no longer in the catalog
          "profile:jack": 42, // not even an id
          [`list:${"9".repeat(200)}`]: "p1", // key outside the scope-key grammar
        },
      },
      defaultFilterState([]),
    );
    expect(decoded.scopeBindings).toEqual({ home: "p1" });
  });

  it("decodes a missing or malformed binding map to no bindings", () => {
    const defaults = defaultFilterState([]);
    expect(normalizeFilterState({}, defaults).scopeBindings).toEqual({});
    expect(normalizeFilterState({ scopeBindings: "nope" }, defaults).scopeBindings).toEqual({});
    expect(normalizeFilterState({ scopeBindings: [] }, defaults).scopeBindings).toEqual({});
  });

  it("truncates a decoded binding map past the cap", () => {
    const scopeBindings: Record<string, string> = {};
    for (let i = 0; i < MAX_FILTER_SCOPE_BINDINGS + 10; i++) scopeBindings[`list:${i}`] = "p1";
    const decoded = normalizeFilterState(
      {
        presets: [{ id: "p1", name: "Kept", criteria: {}, onlyMyLanguages: false }],
        scopeBindings,
      },
      defaultFilterState([]),
    );
    expect(Object.keys(decoded.scopeBindings)).toHaveLength(MAX_FILTER_SCOPE_BINDINGS);
  });

  it("accepts well-formed bind/unbind wire commands and rejects malformed ones", () => {
    expect(isFilterCommand({ type: "bind-scope", key: "home", presetId: "p1" })).toBe(true);
    expect(isFilterCommand({ type: "unbind-scope", key: "home" })).toBe(true);

    expect(isFilterCommand({ type: "bind-scope", key: "home" })).toBe(false); // no preset
    expect(isFilterCommand({ type: "bind-scope", key: 1, presetId: "p1" })).toBe(false);
    expect(isFilterCommand({ type: "bind-scope", key: "home", presetId: 1 })).toBe(false);
    expect(isFilterCommand({ type: "bind-scope", key: "home", presetId: "p1", extra: true })).toBe(
      false,
    );
    expect(isFilterCommand({ type: "unbind-scope", key: "home", extra: true })).toBe(false);
    expect(isFilterCommand({ type: "bind-scope", key: "x".repeat(1000), presetId: "p1" })).toBe(
      false,
    );
  });

  it("validates the binding map as a wire snapshot by shape, leaving repair to decoding", () => {
    const base = { ...defaultFilterState([]), scopeBindings: { home: "p1" } };
    // A binding naming an absent preset is still a well-formed snapshot: strict
    // wire validation checks shape, and normalizeFilterState prunes the dangler.
    expect(isFilterState(base)).toBe(true);
    expect(isFilterState({ ...defaultFilterState([]), scopeBindings: { home: 1 } })).toBe(false);
    expect(isFilterState({ ...defaultFilterState([]), scopeBindings: "nope" })).toBe(false);
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
