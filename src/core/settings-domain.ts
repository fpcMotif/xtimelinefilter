export type BackendStrategy = "rest" | "dom" | "graphql";

export const MAX_SETTINGS_ID_LENGTH = 256;
export const MAX_CONVEX_URL_LENGTH = 2_048;
export const MAX_CONVEX_DEVICE_KEY_LENGTH = 4_096;
export const MAX_PALETTE_HOTKEY_LENGTH = 128;
export const MAX_MIRROR_CONFIG_ID_LENGTH = 256;
export const MAX_PILL_POSITION = 1_000_000;

/**
 * "None — always ask": a persisted MARKER, not an empty field. Absence means the
 * user never chose, which resolves silently; this means they asked to be asked,
 * so the no-picker gesture files nothing and says so. A Folder id can never
 * collide with it — ids are `fld_` + base32.
 */
export const ALWAYS_ASK = "ask";

/** How the UI activates (ADR-0006). */
export type Activation = "auto" | "on-demand";

export interface LassoSettings {
  backend: BackendStrategy;
  defaultList?: { ownerUserId: string; listId: string };
  /** Pre-Owner format. Read only to migrate against active Owner truth. */
  defaultListId?: string;
  /**
   * Where the no-picker save files, in one of three distinguishable states:
   * a bare folder id, the {@link ALWAYS_ASK} marker, or absent.
   *
   * A BARE ID on purpose — never an `{ownerUserId, folderId}` tuple like
   * `defaultList`, which silently no-ops whenever a different X account is
   * signed in. A Folder has no Owner, so this fires identically on every
   * account and with none signed in.
   */
  defaultFolderId?: string;
  activation: Activation;
  highContrast: boolean;
  convexUrl?: string;
  convexDeviceKey?: string;
  /** Worker-issued identity for one complete Mirror credential pair. */
  mirrorConfigId?: string;
  surfaces: { pill: boolean; palette: boolean };
  pillPosition: { x: number; y: number };
  paletteHotkey: string;
}

/** A public update. Nested display records merge rather than replace. */
export type SettingsPatch = Omit<
  Partial<LassoSettings>,
  "mirrorConfigId" | "surfaces" | "pillPosition"
> & {
  surfaces?: Partial<LassoSettings["surfaces"]>;
  pillPosition?: Partial<LassoSettings["pillPosition"]>;
};

export const DEFAULT_SETTINGS: LassoSettings = {
  backend: "rest",
  activation: "auto",
  highContrast: false,
  // Development may opt into the local Mirror. Production never ships its key.
  // v8 ignore next -- Vitest always compiles this module in dev mode; production builds cover false.
  convexUrl: import.meta.env.DEV ? import.meta.env.VITE_CONVEX_URL || undefined : undefined,
  // v8 ignore next -- Vitest always compiles this module in dev mode; production builds cover false.
  convexDeviceKey: import.meta.env.DEV
    ? import.meta.env.VITE_LASSO_DEVICE_KEY || undefined
    : undefined,
  mirrorConfigId: undefined,
  defaultFolderId: undefined,
  surfaces: { pill: true, palette: false },
  pillPosition: { x: 24, y: 96 },
  paletteHotkey: "mod+shift+f",
};

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const has = (value: RecordValue, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const codePointsAtMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};

const boundedString = (value: unknown, max: number, allowEmpty = false): string | undefined =>
  typeof value === "string" &&
  (allowEmpty || value.trim().length > 0) &&
  codePointsAtMost(value, max)
    ? value
    : undefined;

const stringOr = (
  value: unknown,
  fallback: string | undefined,
  max: number,
  allowEmpty = false,
): string | undefined => boundedString(value, max, allowEmpty) ?? fallback;

const optionalString = (
  value: RecordValue,
  key: "convexUrl" | "convexDeviceKey",
  fallback: string | undefined,
): string | undefined => {
  if (!has(value, key)) return undefined;
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return undefined;
  const max = key === "convexUrl" ? MAX_CONVEX_URL_LENGTH : MAX_CONVEX_DEVICE_KEY_LENGTH;
  return stringOr(candidate, fallback, max);
};

const settingsDefaults = (raw: unknown): RecordValue => {
  const stored = isRecord(raw) ? raw : {};
  const surfaces = isRecord(stored.surfaces) ? stored.surfaces : {};
  const pillPosition = isRecord(stored.pillPosition) ? stored.pillPosition : {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    surfaces: { ...DEFAULT_SETTINGS.surfaces, ...surfaces },
    pillPosition: { ...DEFAULT_SETTINGS.pillPosition, ...pillPosition },
  };
};

const mirrorConfigId = (value: unknown): string | undefined =>
  boundedString(value, MAX_MIRROR_CONFIG_ID_LENGTH);

const pillCoordinate = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PILL_POSITION
    ? value
    : fallback;

const configured = (settings: LassoSettings): boolean =>
  Boolean(settings.convexUrl && settings.convexDeviceKey);

const sameCredentials = (left: LassoSettings, right: LassoSettings): boolean =>
  left.convexUrl === right.convexUrl && left.convexDeviceKey === right.convexDeviceKey;

const defaultListOr = (value: unknown): LassoSettings["defaultList"] => {
  if (!isRecord(value)) return DEFAULT_SETTINGS.defaultList;
  const ownerUserId = boundedString(value.ownerUserId, MAX_SETTINGS_ID_LENGTH);
  const listId = boundedString(value.listId, MAX_SETTINGS_ID_LENGTH);
  return ownerUserId && listId ? { ownerUserId, listId } : DEFAULT_SETTINGS.defaultList;
};

/** Storage boundary. Unknown and malformed values never leave this module. */
export function normalizeSettings(raw: unknown): LassoSettings {
  const value = isRecord(raw) ? raw : {};
  const surfaces = isRecord(value.surfaces) ? value.surfaces : {};
  const position = isRecord(value.pillPosition) ? value.pillPosition : {};
  const convexUrl = optionalString(value, "convexUrl", DEFAULT_SETTINGS.convexUrl);
  const convexDeviceKey = optionalString(
    value,
    "convexDeviceKey",
    DEFAULT_SETTINGS.convexDeviceKey,
  );

  return {
    backend:
      value.backend === "rest" || value.backend === "dom" || value.backend === "graphql"
        ? value.backend
        : DEFAULT_SETTINGS.backend,
    defaultList: defaultListOr(value.defaultList),
    defaultListId: stringOr(
      value.defaultListId,
      DEFAULT_SETTINGS.defaultListId,
      MAX_SETTINGS_ID_LENGTH,
    ),
    defaultFolderId: stringOr(
      value.defaultFolderId,
      DEFAULT_SETTINGS.defaultFolderId,
      MAX_SETTINGS_ID_LENGTH,
    ),
    activation:
      value.activation === "auto" || value.activation === "on-demand"
        ? value.activation
        : DEFAULT_SETTINGS.activation,
    highContrast:
      typeof value.highContrast === "boolean" ? value.highContrast : DEFAULT_SETTINGS.highContrast,
    convexUrl,
    convexDeviceKey,
    mirrorConfigId: convexUrl && convexDeviceKey ? mirrorConfigId(value.mirrorConfigId) : undefined,
    surfaces: {
      pill: typeof surfaces.pill === "boolean" ? surfaces.pill : DEFAULT_SETTINGS.surfaces.pill,
      palette:
        typeof surfaces.palette === "boolean"
          ? surfaces.palette
          : DEFAULT_SETTINGS.surfaces.palette,
    },
    pillPosition: {
      x: pillCoordinate(position.x, DEFAULT_SETTINGS.pillPosition.x),
      y: pillCoordinate(position.y, DEFAULT_SETTINGS.pillPosition.y),
    },
    paletteHotkey: stringOr(
      value.paletteHotkey,
      DEFAULT_SETTINGS.paletteHotkey,
      MAX_PALETTE_HOTKEY_LENGTH,
    )!,
  };
}

/** Merge a public patch without losing nested siblings or accepting a Mirror id. */
export function mergeSettings(base: LassoSettings, patch: SettingsPatch): LassoSettings {
  const value = patch as RecordValue;
  const { mirrorConfigId: _ignored, surfaces, pillPosition, ...rest } = value;
  return {
    ...base,
    ...rest,
    surfaces: isRecord(surfaces) ? { ...base.surfaces, ...surfaces } : base.surfaces,
    pillPosition: isRecord(pillPosition)
      ? { ...base.pillPosition, ...pillPosition }
      : base.pillPosition,
  } as LassoSettings;
}

/** Full equality, including the internal Mirror identity. */
export function sameSettings(left: LassoSettings, right: LassoSettings): boolean {
  return (
    left.backend === right.backend &&
    left.defaultList?.ownerUserId === right.defaultList?.ownerUserId &&
    left.defaultList?.listId === right.defaultList?.listId &&
    left.defaultListId === right.defaultListId &&
    left.defaultFolderId === right.defaultFolderId &&
    left.activation === right.activation &&
    left.highContrast === right.highContrast &&
    left.convexUrl === right.convexUrl &&
    left.convexDeviceKey === right.convexDeviceKey &&
    left.mirrorConfigId === right.mirrorConfigId &&
    left.surfaces.pill === right.surfaces.pill &&
    left.surfaces.palette === right.surfaces.palette &&
    left.pillPosition.x === right.pillPosition.x &&
    left.pillPosition.y === right.pillPosition.y &&
    left.paletteHotkey === right.paletteHotkey
  );
}

/** Equality for controlled UI. Mirror identity is not user-visible. */
export function sameUserVisibleSettings(left: LassoSettings, right: LassoSettings): boolean {
  return sameSettings(
    { ...left, mirrorConfigId: undefined },
    { ...right, mirrorConfigId: undefined },
  );
}

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => has(right, key) && sameValue(left[key], right[key]))
  );
};

const wantsClear = (
  raw: RecordValue,
  patch: SettingsPatch | undefined,
  key: "convexUrl" | "convexDeviceKey",
): boolean =>
  raw[key] === null ||
  (has(raw, key) && raw[key] === undefined) ||
  (patch !== undefined &&
    has(patch as RecordValue, key) &&
    (patch as RecordValue)[key] === undefined);

/** Canonical persisted blob. Null keeps an intentional dev-default credential clear. */
export function encodeSettings(
  settings: LassoSettings,
  raw: unknown,
  patch?: SettingsPatch,
): Record<string, unknown> {
  const previous = isRecord(raw) ? raw : {};
  const stored: RecordValue = {
    backend: settings.backend,
    activation: settings.activation,
    highContrast: settings.highContrast,
    surfaces: { ...settings.surfaces },
    pillPosition: { ...settings.pillPosition },
    paletteHotkey: settings.paletteHotkey,
  };
  if (settings.defaultList) stored.defaultList = { ...settings.defaultList };
  if (settings.defaultListId !== undefined) stored.defaultListId = settings.defaultListId;
  if (settings.defaultFolderId !== undefined) stored.defaultFolderId = settings.defaultFolderId;
  if (settings.convexUrl !== undefined) stored.convexUrl = settings.convexUrl;
  else if (wantsClear(previous, patch, "convexUrl")) stored.convexUrl = null;
  if (settings.convexDeviceKey !== undefined) stored.convexDeviceKey = settings.convexDeviceKey;
  else if (wantsClear(previous, patch, "convexDeviceKey")) stored.convexDeviceKey = null;
  if (settings.mirrorConfigId !== undefined) stored.mirrorConfigId = settings.mirrorConfigId;
  return stored;
}

export interface SettingsTransition {
  /** Public, normalized authority. */
  settings: LassoSettings;
  /** Canonical storage form. */
  stored: Record<string, unknown>;
  /** A caller must persist this canonical repair. */
  changed: boolean;
}

/**
 * The one Mirror-id rule. A worker supplies `createMirrorConfigId`; callers never
 * submit an id. A credential change or completion mints one, unrelated changes do
 * not. `previousRaw` lets injected test storage repair an external stale id.
 */
export function transitionSettings(
  raw: unknown,
  createMirrorConfigId: () => string,
  patch?: SettingsPatch,
  previousRaw?: unknown,
): SettingsTransition {
  const current = normalizeSettings(settingsDefaults(raw));
  let next = patch === undefined ? current : normalizeSettings(mergeSettings(current, patch));
  const previous =
    previousRaw === undefined ? undefined : normalizeSettings(settingsDefaults(previousRaw));

  if (configured(next)) {
    const credentialsChanged = !sameCredentials(current, next);
    const staleExternalId =
      patch === undefined &&
      previous !== undefined &&
      !sameCredentials(previous, next) &&
      next.mirrorConfigId === previous.mirrorConfigId;
    if (credentialsChanged || staleExternalId || !next.mirrorConfigId) {
      const id = mirrorConfigId(createMirrorConfigId());
      if (!id) throw new Error("Mirror config identity must not be empty.");
      next = { ...next, mirrorConfigId: id };
    }
  }

  const stored = encodeSettings(next, raw, patch);
  return { settings: next, stored, changed: !sameValue(raw, stored) };
}
