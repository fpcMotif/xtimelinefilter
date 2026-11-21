import { CRITERIA_BY_ID, LINK_DEST_LABELS } from "@/core/filter-criteria";
import type {
  CriterionId,
  FilterMode,
  FilterPreset,
  FilterScope,
  FilterScopeKey,
  FilterState,
  LinkDest,
  LinkRule,
} from "@/core/filter-types";

export const MAX_FILTER_LANGUAGES = 64;
export const MAX_FILTER_LANGUAGE_LENGTH = 32;
export const MAX_FILTER_LINK_RULES = 256;
export const MAX_FILTER_PRESETS = 128;
export const MAX_FILTER_NAME_LENGTH = 120;
export const MAX_FILTER_ID_LENGTH = 128;
export const MAX_FILTER_SCOPE_BINDINGS = 128;

/**
 * Exactly the keys {@link bindingKey} can produce — Home, a numeric List id, or
 * a case-folded handle. Validating the grammar (not merely "some bounded
 * string") matters because an unreachable key is never self-healed the way a
 * dangling preset id is: no navigation can ever resolve to it, so a forged or
 * replayed command would park junk in the bounded map forever. It also rejects
 * an un-folded `profile:Jack`, which would otherwise shadow the real binding.
 */
const SCOPE_KEY = /^(?:home|list:\d{1,20}|profile:[a-z0-9_]{1,15})$/;

const isScopeKey = (value: unknown): value is FilterScopeKey =>
  typeof value === "string" && SCOPE_KEY.test(value);

const NEXT_MODE: Record<FilterMode, FilterMode> = { off: "only", only: "hide", hide: "off" };

/**
 * The key a scope's preset binding is stored under, or null when the scope
 * cannot be bound. Null is a policy answer, not a missing name: Bookmarks and
 * History are real Filter scopes that spec #31 deliberately leaves unbindable
 * for now.
 */
export function bindingKey(scope: FilterScope): FilterScopeKey | null {
  switch (scope.kind) {
    case "home":
      return "home";
    case "list":
      return `list:${scope.listId}`;
    case "profile":
      return `profile:${scope.handle}`;
    case "bookmarks":
    case "history":
      return null;
  }
}

export type FilterCommand =
  | { type: "cycle"; id: CriterionId }
  | { type: "set-mode"; id: CriterionId; mode: FilterMode }
  | { type: "set-only-my-languages"; on: boolean }
  | { type: "set-my-languages"; languages: string[] }
  | { type: "set-link-rules"; rules: LinkRule[] }
  | { type: "set-enabled"; on: boolean }
  | { type: "set-compact-hidden"; on: boolean }
  | { type: "save-preset"; id: string; name: string }
  | { type: "apply-preset"; id: string }
  | { type: "rename-preset"; id: string; name: string }
  | { type: "delete-preset"; id: string }
  | { type: "bind-scope"; key: FilterScopeKey; presetId: string }
  | { type: "unbind-scope"; key: FilterScopeKey }
  | { type: "restore"; state: FilterState };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const has = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

/** "ja-JP" → "ja"; lowercased, trimmed, empties dropped, deduped in order. */
export function normalizeLangs(langs: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of langs) {
    const base = raw.split("-")[0]?.toLowerCase().trim();
    if (base && base.length <= MAX_FILTER_LANGUAGE_LENGTH && !out.includes(base)) out.push(base);
    if (out.length === MAX_FILTER_LANGUAGES) break;
  }
  return out;
}

export function defaultFilterState(navLanguages: readonly string[]): FilterState {
  return {
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: normalizeLangs(navLanguages),
    linkRules: [],
    presets: [],
    compactHidden: false,
    scopeBindings: {},
  };
}

function normalizeCriteria(raw: unknown): Record<CriterionId, FilterMode> {
  if (!isRecord(raw)) return {};
  const criteria: Record<CriterionId, FilterMode> = {};
  for (const [id, mode] of Object.entries(raw)) {
    if (CRITERIA_BY_ID.has(id) && (mode === "only" || mode === "hide")) criteria[id] = mode;
  }
  return criteria;
}

function normalizeLanguages(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return normalizeLangs(raw.filter((language): language is string => typeof language === "string"));
}

function normalizeLinkRules(raw: unknown): LinkRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((rule) => {
      if (
        !isRecord(rule) ||
        !isBoundedString(rule.host, 253) ||
        typeof rule.dest !== "string" ||
        !Object.hasOwn(LINK_DEST_LABELS, rule.dest)
      )
        return [];
      return [{ host: rule.host, dest: rule.dest as LinkDest }];
    })
    .slice(0, MAX_FILTER_LINK_RULES);
}

function normalizePresets(raw: unknown): FilterPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((preset) => {
      if (
        !isRecord(preset) ||
        !isBoundedString(preset.id, MAX_FILTER_ID_LENGTH) ||
        !isBoundedString(preset.name, MAX_FILTER_NAME_LENGTH) ||
        typeof preset.onlyMyLanguages !== "boolean" ||
        !isRecord(preset.criteria) ||
        (preset.myLanguages !== undefined && !Array.isArray(preset.myLanguages))
      )
        return [];
      const next: FilterPreset = {
        id: preset.id,
        name: preset.name,
        criteria: normalizeCriteria(preset.criteria),
        onlyMyLanguages: preset.onlyMyLanguages,
      };
      if (preset.myLanguages !== undefined)
        next.myLanguages = normalizeLanguages(preset.myLanguages, []);
      return [next];
    })
    .slice(0, MAX_FILTER_PRESETS);
}

/**
 * Bindings are decoded against the presets that survived decoding, so a pointer
 * to a preset that is gone — deleted on another device, or dropped by preset
 * normalization here — is pruned rather than left dangling. That is what makes
 * deleting a bound preset fall its scopes back to the shared selection.
 */
function normalizeScopeBindings(
  raw: unknown,
  presets: readonly FilterPreset[],
): Record<FilterScopeKey, string> {
  if (!isRecord(raw)) return {};
  const known = new Set(presets.map((preset) => preset.id));
  const bindings: Record<FilterScopeKey, string> = {};
  for (const [key, presetId] of Object.entries(raw)) {
    if (!isScopeKey(key)) continue;
    if (!isBoundedString(presetId, MAX_FILTER_ID_LENGTH) || !known.has(presetId)) continue;
    bindings[key] = presetId;
    if (Object.keys(bindings).length === MAX_FILTER_SCOPE_BINDINGS) break;
  }
  return bindings;
}

/** Decode persisted state at the worker/client storage seam. */
export function normalizeFilterState(raw: unknown, defaults: FilterState): FilterState {
  const value = isRecord(raw) ? raw : {};
  const presets = normalizePresets(value.presets);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    criteria: normalizeCriteria(value.criteria),
    onlyMyLanguages:
      typeof value.onlyMyLanguages === "boolean" ? value.onlyMyLanguages : defaults.onlyMyLanguages,
    myLanguages: normalizeLanguages(value.myLanguages, defaults.myLanguages),
    linkRules: normalizeLinkRules(value.linkRules),
    presets,
    compactHidden:
      typeof value.compactHidden === "boolean" ? value.compactHidden : defaults.compactHidden,
    scopeBindings: normalizeScopeBindings(value.scopeBindings, presets),
  };
}

export function selectionChanged(a: FilterState, b: FilterState): boolean {
  if (a.enabled !== b.enabled || a.onlyMyLanguages !== b.onlyMyLanguages) return true;
  const aCriteria = Object.entries(a.criteria);
  const bCriteria = Object.entries(b.criteria);
  if (
    aCriteria.length !== bCriteria.length ||
    aCriteria.some(([id, mode]) => b.criteria[id as CriterionId] !== mode)
  )
    return true;
  if (
    a.myLanguages.length !== b.myLanguages.length ||
    a.myLanguages.some((language, index) => b.myLanguages[index] !== language)
  )
    return true;
  return (
    a.linkRules.length !== b.linkRules.length ||
    a.linkRules.some(
      (rule, index) =>
        b.linkRules[index]?.host !== rule.host || b.linkRules[index]?.dest !== rule.dest,
    )
  );
}

const isLanguages = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= MAX_FILTER_LANGUAGES &&
  value.every((language) => isBoundedString(language, MAX_FILTER_LANGUAGE_LENGTH));

const isCriterionId = (value: unknown): value is CriterionId =>
  isBoundedString(value, MAX_FILTER_ID_LENGTH) && CRITERIA_BY_ID.has(value);

const isFilterMode = (value: unknown): value is FilterMode =>
  value === "off" || value === "only" || value === "hide";

const isLinkRules = (value: unknown): value is LinkRule[] =>
  Array.isArray(value) &&
  value.length <= MAX_FILTER_LINK_RULES &&
  value.every(
    (rule) =>
      isRecord(rule) &&
      Object.keys(rule).every((key) => key === "host" || key === "dest") &&
      isBoundedString(rule.host, 253) &&
      typeof rule.dest === "string" &&
      Object.hasOwn(LINK_DEST_LABELS, rule.dest),
  );

const isCriteria = (value: unknown): value is Record<CriterionId, FilterMode> =>
  isRecord(value) &&
  Object.entries(value).every(
    ([id, mode]) => isCriterionId(id) && (mode === "only" || mode === "hide"),
  );

const isPreset = (value: unknown): value is FilterPreset =>
  isRecord(value) &&
  Object.keys(value).every(
    (key) =>
      key === "id" ||
      key === "name" ||
      key === "criteria" ||
      key === "onlyMyLanguages" ||
      key === "myLanguages",
  ) &&
  has(value, "id") &&
  has(value, "name") &&
  has(value, "criteria") &&
  has(value, "onlyMyLanguages") &&
  isBoundedString(value.id, MAX_FILTER_ID_LENGTH) &&
  isBoundedString(value.name, MAX_FILTER_NAME_LENGTH) &&
  isCriteria(value.criteria) &&
  typeof value.onlyMyLanguages === "boolean" &&
  (value.myLanguages === undefined || isLanguages(value.myLanguages));

/**
 * Shape only, deliberately: a binding naming an absent preset is still a
 * well-formed snapshot, and {@link normalizeFilterState} prunes it. Rejecting
 * the whole snapshot over one stale pointer would throw away a valid Undo.
 */
const isScopeBindings = (value: unknown): value is Record<FilterScopeKey, string> =>
  isRecord(value) &&
  Object.keys(value).length <= MAX_FILTER_SCOPE_BINDINGS &&
  Object.entries(value).every(
    ([key, presetId]) => isScopeKey(key) && isBoundedString(presetId, MAX_FILTER_ID_LENGTH),
  );

/** Strict, bounded wire snapshot validation. */
export function isFilterState(value: unknown): value is FilterState {
  if (
    !isRecord(value) ||
    !Object.keys(value).every((key) =>
      [
        "enabled",
        "criteria",
        "onlyMyLanguages",
        "myLanguages",
        "linkRules",
        "presets",
        "compactHidden",
        "scopeBindings",
      ].includes(key),
    ) ||
    !isScopeBindings(value.scopeBindings) ||
    typeof value.enabled !== "boolean" ||
    !isCriteria(value.criteria) ||
    typeof value.onlyMyLanguages !== "boolean" ||
    !isLanguages(value.myLanguages) ||
    !isLinkRules(value.linkRules) ||
    !Array.isArray(value.presets) ||
    value.presets.length > MAX_FILTER_PRESETS ||
    !value.presets.every(isPreset) ||
    typeof value.compactHidden !== "boolean"
  )
    return false;
  return true;
}

/** Strict, bounded wire command validation. */
export function isFilterCommand(value: unknown): value is FilterCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "cycle":
      return (
        isCriterionId(value.id) && Object.keys(value).every((key) => key === "type" || key === "id")
      );
    case "set-mode":
      return (
        isCriterionId(value.id) &&
        isFilterMode(value.mode) &&
        Object.keys(value).every((key) => key === "type" || key === "id" || key === "mode")
      );
    case "set-only-my-languages":
    case "set-enabled":
    case "set-compact-hidden":
      return (
        typeof value.on === "boolean" &&
        Object.keys(value).every((key) => key === "type" || key === "on")
      );
    case "set-my-languages":
      return (
        isLanguages(value.languages) &&
        Object.keys(value).every((key) => key === "type" || key === "languages")
      );
    case "set-link-rules":
      return (
        isLinkRules(value.rules) &&
        Object.keys(value).every((key) => key === "type" || key === "rules")
      );
    case "save-preset":
    case "rename-preset":
      return (
        isBoundedString(value.id, MAX_FILTER_ID_LENGTH) &&
        isBoundedString(value.name, MAX_FILTER_NAME_LENGTH) &&
        Object.keys(value).every((key) => key === "type" || key === "id" || key === "name")
      );
    case "apply-preset":
    case "delete-preset":
      return (
        isBoundedString(value.id, MAX_FILTER_ID_LENGTH) &&
        Object.keys(value).every((key) => key === "type" || key === "id")
      );
    case "bind-scope":
      return (
        isScopeKey(value.key) &&
        isBoundedString(value.presetId, MAX_FILTER_ID_LENGTH) &&
        Object.keys(value).every(
          (field) => field === "type" || field === "key" || field === "presetId",
        )
      );
    case "unbind-scope":
      return (
        isScopeKey(value.key) &&
        Object.keys(value).every((field) => field === "type" || field === "key")
      );
    case "restore":
      return (
        isFilterState(value.state) &&
        Object.keys(value).every((key) => key === "type" || key === "state")
      );
    default:
      return false;
  }
}

/** Apply one intent against the authority available at execution time. */
export function applyFilterCommand(state: FilterState, command: FilterCommand): FilterState {
  switch (command.type) {
    case "cycle":
      return applyFilterCommand(state, {
        type: "set-mode",
        id: command.id,
        mode: NEXT_MODE[state.criteria[command.id] ?? "off"],
      });
    case "set-mode": {
      const criteria = { ...state.criteria };
      if (command.mode === "off") delete criteria[command.id];
      else criteria[command.id] = command.mode;
      return { ...state, criteria };
    }
    case "set-only-my-languages":
      return { ...state, onlyMyLanguages: command.on };
    case "set-my-languages":
      return { ...state, myLanguages: normalizeLangs(command.languages) };
    case "set-link-rules":
      return { ...state, linkRules: command.rules.map((rule) => ({ ...rule })) };
    case "set-enabled":
      return { ...state, enabled: command.on };
    case "set-compact-hidden":
      return { ...state, compactHidden: command.on };
    case "save-preset": {
      // UUIDs come from the client, but the worker must still protect its
      // bounded, id-addressable catalog from a forged or replayed command.
      if (
        state.presets.length >= MAX_FILTER_PRESETS ||
        state.presets.some((preset) => preset.id === command.id)
      )
        return state;
      const preset: FilterPreset = {
        id: command.id,
        name: command.name,
        criteria: { ...state.criteria },
        onlyMyLanguages: state.onlyMyLanguages,
        myLanguages: [...state.myLanguages],
      };
      return { ...state, presets: [...state.presets, preset] };
    }
    case "apply-preset": {
      const preset = state.presets.find((candidate) => candidate.id === command.id);
      if (!preset) return state;
      return {
        ...state,
        criteria: { ...preset.criteria },
        onlyMyLanguages: preset.onlyMyLanguages,
        ...(preset.myLanguages ? { myLanguages: [...preset.myLanguages] } : {}),
      };
    }
    case "rename-preset":
      return {
        ...state,
        presets: state.presets.map((preset) =>
          preset.id === command.id ? { ...preset, name: command.name } : preset,
        ),
      };
    case "delete-preset": {
      const presets = state.presets.filter((preset) => preset.id !== command.id);
      // Prune here rather than waiting for the next decode, so those scopes fall
      // back to the shared selection immediately and no surface ever renders a
      // binding pointing at a preset that is gone. Decoding prunes too — that
      // path guards state written by another device, not by this command.
      return {
        ...state,
        presets,
        scopeBindings: normalizeScopeBindings(state.scopeBindings, presets),
      };
    }
    case "bind-scope": {
      // The worker must protect its bounded map from a forged or replayed
      // command, and a binding may only ever point at a preset that exists.
      if (!state.presets.some((preset) => preset.id === command.presetId)) return state;
      const isNew = !Object.hasOwn(state.scopeBindings, command.key);
      if (isNew && Object.keys(state.scopeBindings).length >= MAX_FILTER_SCOPE_BINDINGS)
        return state;
      return {
        ...state,
        scopeBindings: { ...state.scopeBindings, [command.key]: command.presetId },
      };
    }
    case "unbind-scope": {
      if (!Object.hasOwn(state.scopeBindings, command.key)) return state;
      const { [command.key]: _removed, ...scopeBindings } = state.scopeBindings;
      return { ...state, scopeBindings };
    }
    case "restore":
      return normalizeFilterState(command.state, state);
  }
}
