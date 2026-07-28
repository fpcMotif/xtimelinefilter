import {
  MAX_CONVEX_DEVICE_KEY_LENGTH,
  MAX_CONVEX_URL_LENGTH,
  MAX_MIRROR_CONFIG_ID_LENGTH,
  MAX_PALETTE_HOTKEY_LENGTH,
  MAX_PILL_POSITION,
  MAX_SETTINGS_ID_LENGTH,
  type Activation,
  type BackendStrategy,
  type LassoSettings,
  type SettingsPatch,
} from "@/core/settings-domain";

export type SettingsWirePatch = {
  backend?: BackendStrategy;
  defaultList?: { ownerUserId: string; listId: string } | null;
  defaultListId?: string | null;
  defaultFolderId?: string | null;
  activation?: Activation;
  highContrast?: boolean;
  convexUrl?: string | null;
  convexDeviceKey?: string | null;
  surfaces?: { pill?: boolean; palette?: boolean };
  pillPosition?: { x?: number; y?: number };
  paletteHotkey?: string;
};
export type SettingsRequest =
  | { type: "lasso:settings"; operation: "read" }
  | { type: "lasso:settings"; operation: "patch"; patch: SettingsWirePatch };
export type SettingsResponse = { ok: true; settings: LassoSettings } | { ok: false; error: string };

const PATCH_KEYS = new Set<keyof SettingsWirePatch>([
  "backend",
  "defaultList",
  "defaultListId",
  "defaultFolderId",
  "activation",
  "highContrast",
  "convexUrl",
  "convexDeviceKey",
  "surfaces",
  "pillPosition",
  "paletteHotkey",
]);
const SNAPSHOT_KEYS = [
  "backend",
  "defaultList",
  "defaultListId",
  "defaultFolderId",
  "activation",
  "highContrast",
  "convexUrl",
  "convexDeviceKey",
  "mirrorConfigId",
  "surfaces",
  "pillPosition",
  "paletteHotkey",
] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const has = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);
const keysAreKnown = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const atMost = (value: string, max: number): boolean => {
  let count = 0;
  for (const _point of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
};
const boundedStringOrNull = (value: unknown, max: number): boolean =>
  value === null || (typeof value === "string" && value.trim().length > 0 && atMost(value, max));
const defaultList = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    keysAreKnown(value, ["ownerUserId", "listId"]) &&
    typeof value.ownerUserId === "string" &&
    value.ownerUserId.trim().length > 0 &&
    atMost(value.ownerUserId, MAX_SETTINGS_ID_LENGTH) &&
    typeof value.listId === "string" &&
    value.listId.trim().length > 0 &&
    atMost(value.listId, MAX_SETTINGS_ID_LENGTH));
const surfaces = (value: unknown): boolean =>
  isRecord(value) &&
  keysAreKnown(value, ["pill", "palette"]) &&
  (!has(value, "pill") || typeof value.pill === "boolean") &&
  (!has(value, "palette") || typeof value.palette === "boolean");
const pillPosition = (value: unknown): boolean =>
  isRecord(value) &&
  keysAreKnown(value, ["x", "y"]) &&
  (!has(value, "x") ||
    (typeof value.x === "number" &&
      Number.isFinite(value.x) &&
      value.x >= 0 &&
      value.x <= MAX_PILL_POSITION)) &&
  (!has(value, "y") ||
    (typeof value.y === "number" &&
      Number.isFinite(value.y) &&
      value.y >= 0 &&
      value.y <= MAX_PILL_POSITION));

export function isSettingsRequest(msg: unknown): msg is SettingsRequest {
  if (!isRecord(msg) || msg.type !== "lasso:settings") return false;
  if (msg.operation === "read")
    return Object.keys(msg).every((key) => key === "type" || key === "operation");
  if (
    msg.operation !== "patch" ||
    !isRecord(msg.patch) ||
    !Object.keys(msg).every((key) => key === "type" || key === "operation" || key === "patch")
  )
    return false;
  const patch = msg.patch;
  if (!keysAreKnown(patch, [...PATCH_KEYS])) return false;
  return (
    (!has(patch, "backend") ||
      patch.backend === "rest" ||
      patch.backend === "dom" ||
      patch.backend === "graphql") &&
    (!has(patch, "defaultList") || defaultList(patch.defaultList)) &&
    (!has(patch, "defaultListId") ||
      boundedStringOrNull(patch.defaultListId, MAX_SETTINGS_ID_LENGTH)) &&
    (!has(patch, "defaultFolderId") ||
      boundedStringOrNull(patch.defaultFolderId, MAX_SETTINGS_ID_LENGTH)) &&
    (!has(patch, "activation") ||
      patch.activation === "auto" ||
      patch.activation === "on-demand") &&
    (!has(patch, "highContrast") || typeof patch.highContrast === "boolean") &&
    (!has(patch, "convexUrl") || boundedStringOrNull(patch.convexUrl, MAX_CONVEX_URL_LENGTH)) &&
    (!has(patch, "convexDeviceKey") ||
      boundedStringOrNull(patch.convexDeviceKey, MAX_CONVEX_DEVICE_KEY_LENGTH)) &&
    (!has(patch, "surfaces") || surfaces(patch.surfaces)) &&
    (!has(patch, "pillPosition") || pillPosition(patch.pillPosition)) &&
    (!has(patch, "paletteHotkey") ||
      (typeof patch.paletteHotkey === "string" &&
        patch.paletteHotkey.trim().length > 0 &&
        atMost(patch.paletteHotkey, MAX_PALETTE_HOTKEY_LENGTH)))
  );
}

export function encodeSettingsPatch(patch: SettingsPatch): SettingsWirePatch {
  const source = patch as Record<string, unknown>;
  const wire: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!has(source, key)) continue;
    const value = source[key];
    wire[key] =
      key === "defaultList" ||
      key === "defaultListId" ||
      key === "defaultFolderId" ||
      key === "convexUrl" ||
      key === "convexDeviceKey"
        ? (value ?? null)
        : value;
  }
  return wire as SettingsWirePatch;
}

export function decodeSettingsPatch(patch: SettingsWirePatch): SettingsPatch {
  const wire = patch as Record<string, unknown>;
  const decoded: Record<string, unknown> = {};
  for (const key of PATCH_KEYS) {
    if (!has(wire, key)) continue;
    decoded[key] =
      (key === "defaultList" ||
        key === "defaultListId" ||
        key === "defaultFolderId" ||
        key === "convexUrl" ||
        key === "convexDeviceKey") &&
      wire[key] === null
        ? undefined
        : wire[key];
  }
  return decoded as SettingsPatch;
}

const optionalString = (value: Record<string, unknown>, key: string, max: number): boolean =>
  !has(value, key) ||
  value[key] === undefined ||
  (typeof value[key] === "string" && value[key].trim().length > 0 && atMost(value[key], max));
const isSnapshot = (value: unknown): value is LassoSettings => {
  if (!isRecord(value) || !keysAreKnown(value, SNAPSHOT_KEYS)) return false;
  const position = value.pillPosition;
  const surface = value.surfaces;
  const list = value.defaultList;
  if (
    !has(value, "backend") ||
    !has(value, "activation") ||
    !has(value, "highContrast") ||
    !has(value, "surfaces") ||
    !has(value, "pillPosition") ||
    !has(value, "paletteHotkey") ||
    !(value.backend === "rest" || value.backend === "dom" || value.backend === "graphql") ||
    !(value.activation === "auto" || value.activation === "on-demand") ||
    typeof value.highContrast !== "boolean" ||
    typeof value.paletteHotkey !== "string" ||
    value.paletteHotkey.trim().length === 0 ||
    !atMost(value.paletteHotkey, MAX_PALETTE_HOTKEY_LENGTH) ||
    !isRecord(surface) ||
    !keysAreKnown(surface, ["pill", "palette"]) ||
    typeof surface.pill !== "boolean" ||
    typeof surface.palette !== "boolean" ||
    !isRecord(position) ||
    !keysAreKnown(position, ["x", "y"]) ||
    typeof position.x !== "number" ||
    !Number.isFinite(position.x) ||
    position.x < 0 ||
    position.x > MAX_PILL_POSITION ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.y) ||
    position.y < 0 ||
    position.y > MAX_PILL_POSITION ||
    !optionalString(value, "defaultListId", MAX_SETTINGS_ID_LENGTH) ||
    !optionalString(value, "defaultFolderId", MAX_SETTINGS_ID_LENGTH) ||
    !optionalString(value, "convexUrl", MAX_CONVEX_URL_LENGTH) ||
    !optionalString(value, "convexDeviceKey", MAX_CONVEX_DEVICE_KEY_LENGTH) ||
    !optionalString(value, "mirrorConfigId", MAX_MIRROR_CONFIG_ID_LENGTH)
  )
    return false;
  return (
    list === undefined ||
    (isRecord(list) &&
      keysAreKnown(list, ["ownerUserId", "listId"]) &&
      typeof list.ownerUserId === "string" &&
      list.ownerUserId.trim().length > 0 &&
      atMost(list.ownerUserId, MAX_SETTINGS_ID_LENGTH) &&
      typeof list.listId === "string" &&
      list.listId.trim().length > 0 &&
      atMost(list.listId, MAX_SETTINGS_ID_LENGTH))
  );
};

function response(value: unknown): LassoSettings {
  if (!isRecord(value) || typeof value.ok !== "boolean")
    throw new Error("Invalid settings response");
  if (!value.ok) {
    if (typeof value.error !== "string") throw new Error("Invalid settings response");
    throw new Error(value.error);
  }
  if (!isSnapshot(value.settings)) throw new Error("Invalid settings response");
  return value.settings;
}

export function requestSettingsRead(): Promise<LassoSettings> {
  return chrome.runtime.sendMessage({ type: "lasso:settings", operation: "read" }).then(response);
}
export function requestSettingsPatch(patch: SettingsPatch): Promise<LassoSettings> {
  const request = {
    type: "lasso:settings" as const,
    operation: "patch" as const,
    patch: encodeSettingsPatch(patch),
  };
  if (!isSettingsRequest(request)) return Promise.reject(new Error("Invalid settings patch"));
  return chrome.runtime.sendMessage(request).then(response);
}
