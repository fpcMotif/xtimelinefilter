import { CRITERIA_BY_ID, LINK_DEST_LABELS } from "@/core/filter-criteria";
import type {
  CriterionId,
  FilterMode,
  FilterPreset,
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

const NEXT_MODE: Record<FilterMode, FilterMode> = { off: "only", only: "hide", hide: "off" };

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

/** Decode persisted state at the worker/client storage seam. */
export function normalizeFilterState(raw: unknown, defaults: FilterState): FilterState {
  const value = isRecord(raw) ? raw : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    criteria: normalizeCriteria(value.criteria),
    onlyMyLanguages:
      typeof value.onlyMyLanguages === "boolean" ? value.onlyMyLanguages : defaults.onlyMyLanguages,
    myLanguages: normalizeLanguages(value.myLanguages, defaults.myLanguages),
    linkRules: normalizeLinkRules(value.linkRules),
    presets: normalizePresets(value.presets),
    compactHidden:
      typeof value.compactHidden === "boolean" ? value.compactHidden : defaults.compactHidden,
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
      ].includes(key),
    ) ||
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
    case "delete-preset":
      return { ...state, presets: state.presets.filter((preset) => preset.id !== command.id) };
    case "restore":
      return normalizeFilterState(command.state, state);
  }
}
