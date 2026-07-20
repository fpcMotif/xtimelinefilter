import { localArea, syncArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { syncedStore } from "@/core/synced-store";

export type { StorageLike } from "@/core/storage-areas";

export type BackendStrategy = "rest" | "dom" | "graphql";

/** How the UI activates (ADR-0006). "auto" = always-on; "on-demand" = until toolbar click/hotkey. */
export type Activation = "auto" | "on-demand";

export interface LassoSettings {
  /** Active mutation strategy; REST defaults to undocumented web v1.1 endpoints that may change (ADR-0007). */
  backend: BackendStrategy;
  /** When set, Alt+Shift+L adds straight to this List — no picker (story beat 6). */
  defaultList?: { ownerUserId: string; listId: string };
  /** Pre-Owner format. Read only to migrate against fresh active-Owner X truth. */
  defaultListId?: string;
  /** UI activation mode; "auto" (always-on) by default, switchable to "on-demand". */
  activation: Activation;
  /** Accessibility: AA-safe darker-blue button fills (story beat 9). */
  highContrast: boolean;
  /** Convex Mirror deployment URL; unset ⇒ Mirror disabled (ADR-0009). */
  convexUrl?: string;
  /** Convex Mirror device key; the one long-lived credential, unset ⇒ Mirror disabled. */
  convexDeviceKey?: string;
  /** Internal opaque identity for one complete Mirror URL/key configuration. */
  mirrorConfigId?: string;
  /** Independent per-surface toggles for the filter UI (pill / command palette). */
  surfaces: { pill: boolean; palette: boolean };
  /** Persisted floating-pill position (px offset from X's bottom-right docks). */
  pillPosition: { x: number; y: number };
  /** Shortcut that opens the command palette. */
  paletteHotkey: string;
}

export const DEFAULT_SETTINGS: LassoSettings = {
  backend: "rest", // Current default: X's undocumented web v1.1 endpoints may change.
  activation: "auto",
  highContrast: false,
  // Mirror config falls back to the build-time Convex env (.env.local) ONLY in dev
  // builds, so a contributor's fresh profile reaches the deployment with no manual
  // setup. Production builds never inline the credential (M1: a shipped device key
  // is one extracted key = full read/write) — prod users enter the URL + device key
  // in Options, and an absent key keeps the Mirror off (ADR-0009).
  convexUrl: import.meta.env.DEV ? import.meta.env.VITE_CONVEX_URL || undefined : undefined,
  convexDeviceKey: import.meta.env.DEV
    ? import.meta.env.VITE_LASSO_DEVICE_KEY || undefined
    : undefined,
  mirrorConfigId: undefined,
  surfaces: { pill: true, palette: false },
  pillPosition: { x: 24, y: 96 },
  paletteHotkey: "mod+shift+f",
};

export interface SettingsStore {
  get(): Promise<LassoSettings>;
  set(patch: Partial<LassoSettings>): Promise<LassoSettings>;
  subscribe(cb: (s: LassoSettings) => void): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" ? value : fallback;
}

/** An explicit `undefined`/`null` clears; malformed values fall back to the build default. */
function optionalString(value: unknown, fallback: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : fallback;
}

function clearedOptionalString(
  value: string | undefined,
  previous: unknown,
): string | null | undefined {
  return value === undefined && previous !== undefined ? null : value;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function mirrorConfigured(settings: LassoSettings): boolean {
  return Boolean(settings.convexUrl && settings.convexDeviceKey);
}

function sameMirrorCredentials(left: LassoSettings, right: LassoSettings): boolean {
  return left.convexUrl === right.convexUrl && left.convexDeviceKey === right.convexDeviceKey;
}

function defaultListOr(value: unknown): LassoSettings["defaultList"] {
  if (!isRecord(value)) return DEFAULT_SETTINGS.defaultList;
  if (typeof value.ownerUserId !== "string" || typeof value.listId !== "string") {
    return DEFAULT_SETTINGS.defaultList;
  }
  return { ownerUserId: value.ownerUserId, listId: value.listId };
}

function sameSettings(a: LassoSettings, b: LassoSettings): boolean {
  return (
    a.backend === b.backend &&
    a.defaultList?.ownerUserId === b.defaultList?.ownerUserId &&
    a.defaultList?.listId === b.defaultList?.listId &&
    a.defaultListId === b.defaultListId &&
    a.activation === b.activation &&
    a.highContrast === b.highContrast &&
    a.convexUrl === b.convexUrl &&
    a.convexDeviceKey === b.convexDeviceKey &&
    a.mirrorConfigId === b.mirrorConfigId &&
    a.surfaces.pill === b.surfaces.pill &&
    a.surfaces.palette === b.surfaces.palette &&
    a.pillPosition.x === b.pillPosition.x &&
    a.pillPosition.y === b.pillPosition.y &&
    a.paletteHotkey === b.paletteHotkey
  );
}

/**
 * The domain boundary for the settings blob. Storage is untyped, so only these
 * fields cross into callers; unknown and malformed values fall back to defaults.
 */
export function normalizeSettings(raw: unknown): LassoSettings {
  const value = isRecord(raw) ? raw : {};
  const surfaces = isRecord(value.surfaces) ? value.surfaces : {};
  const position = isRecord(value.pillPosition) ? value.pillPosition : {};

  const convexUrl = optionalString(value.convexUrl, DEFAULT_SETTINGS.convexUrl);
  const convexDeviceKey = optionalString(value.convexDeviceKey, DEFAULT_SETTINGS.convexDeviceKey);

  return {
    backend:
      value.backend === "rest" || value.backend === "dom" || value.backend === "graphql"
        ? value.backend
        : DEFAULT_SETTINGS.backend,
    defaultList: defaultListOr(value.defaultList),
    defaultListId: stringOr(value.defaultListId, DEFAULT_SETTINGS.defaultListId),
    activation:
      value.activation === "auto" || value.activation === "on-demand"
        ? value.activation
        : DEFAULT_SETTINGS.activation,
    highContrast:
      typeof value.highContrast === "boolean" ? value.highContrast : DEFAULT_SETTINGS.highContrast,
    // The synced store supplies build defaults for a missing settings blob. An
    // explicit empty field is different: it is the user's deliberate Mirror
    // opt-out and must not fall back to a development credential.
    convexUrl,
    convexDeviceKey,
    mirrorConfigId: convexUrl && convexDeviceKey ? nonEmptyString(value.mirrorConfigId) : undefined,
    surfaces: {
      pill: typeof surfaces.pill === "boolean" ? surfaces.pill : DEFAULT_SETTINGS.surfaces.pill,
      palette:
        typeof surfaces.palette === "boolean"
          ? surfaces.palette
          : DEFAULT_SETTINGS.surfaces.palette,
    },
    pillPosition: {
      x: Number.isFinite(position.x) ? (position.x as number) : DEFAULT_SETTINGS.pillPosition.x,
      y: Number.isFinite(position.y) ? (position.y as number) : DEFAULT_SETTINGS.pillPosition.y,
    },
    paletteHotkey: stringOr(value.paletteHotkey, DEFAULT_SETTINGS.paletteHotkey)!,
  };
}

/**
 * Typed wrapper over chrome.storage.local with in- and cross-context change
 * notification. A thin face over {@link syncedStore} (which owns the cache, merge,
 * echo-suppression, and the raw listener): get() is a cached read; set() is STRICT
 * — it re-throws on storage failure so the Options page can surface the error, and
 * because lasso:settings holds the Mirror credential (ADR-0009), not the fail-soft
 * filter config. Settings used to live in chrome.storage.sync; a legacy synced copy
 * is moved here once on first read so the device key stops replicating.
 */
export function createSettings(
  area: StorageLike = localArea(),
  createMirrorConfigId: () => string = () => globalThis.crypto.randomUUID(),
  legacySyncArea: StorageLike | null = syncArea(),
): SettingsStore {
  const store = syncedStore<LassoSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS, area, "local");
  let migrated = false;

  async function migrateOnce(): Promise<void> {
    if (migrated) return;
    if (!legacySyncArea) {
      migrated = true;
      return;
    }
    try {
      const localRaw = (await area.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
      if (localRaw !== undefined) {
        migrated = true;
        return; // local is already authoritative
      }
      const synced = (await legacySyncArea.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
      if (synced === undefined) {
        migrated = true;
        return;
      }
      await area.set({ [STORAGE_KEYS.settings]: synced });
      await legacySyncArea.remove?.(STORAGE_KEYS.settings);
      migrated = true;
    } catch {
      // Migration is best-effort; a failure must never break settings reads.
    }
  }
  const subs = new Set<(s: LassoSettings) => void>();
  let quarantinedMirror: LassoSettings | null = null;
  function notify(next: LassoSettings): void {
    for (const cb of subs) cb(next);
  }

  const matchesQuarantinedMirror = (settings: LassoSettings): boolean =>
    quarantinedMirror !== null &&
    settings.convexUrl === quarantinedMirror.convexUrl &&
    settings.convexDeviceKey === quarantinedMirror.convexDeviceKey &&
    settings.mirrorConfigId === quarantinedMirror.mirrorConfigId;
  const withoutQuarantinedMirror = (settings: LassoSettings): LassoSettings =>
    matchesQuarantinedMirror(settings) ? { ...settings, mirrorConfigId: undefined } : settings;

  const freshMirrorConfigId = (): string => {
    const id = createMirrorConfigId();
    if (!nonEmptyString(id)) throw new Error("Mirror config identity must not be empty.");
    return id;
  };
  const withStoredMirrorIdentity = (settings: LassoSettings): LassoSettings => {
    if (!mirrorConfigured(settings)) {
      /* v8 ignore next 3 -- normalizeSettings strips a stored id whenever credentials are incomplete, so an unconfigured `settings` here always has mirrorConfigId undefined */
      return settings.mirrorConfigId === undefined
        ? settings
        : { ...settings, mirrorConfigId: undefined };
    }
    return settings.mirrorConfigId
      ? settings
      : { ...settings, mirrorConfigId: freshMirrorConfigId() };
  };
  const withPatchedMirrorIdentity = (
    current: LassoSettings,
    next: LassoSettings,
  ): LassoSettings => {
    if (!mirrorConfigured(next)) return { ...next, mirrorConfigId: undefined };
    const changed =
      current.convexUrl !== next.convexUrl || current.convexDeviceKey !== next.convexDeviceKey;
    if (changed || !current.mirrorConfigId) {
      return { ...next, mirrorConfigId: freshMirrorConfigId() };
    }
    return { ...next, mirrorConfigId: current.mirrorConfigId };
  };
  const withExternalMirrorIdentity = (
    previous: LassoSettings,
    current: LassoSettings,
  ): LassoSettings => {
    if (!mirrorConfigured(current)) return current;
    if (!current.mirrorConfigId) {
      return { ...current, mirrorConfigId: freshMirrorConfigId() };
    }
    /* v8 ignore next 6 -- onExternalChange computes the identical reuse condition and quarantines it (stripping the id) before calling in, so the branch above already handled this case */
    if (
      !sameMirrorCredentials(previous, current) &&
      current.mirrorConfigId === previous.mirrorConfigId
    ) {
      return { ...current, mirrorConfigId: freshMirrorConfigId() };
    }
    return current;
  };
  const storableSettings = (next: LassoSettings): LassoSettings => {
    const current = store.current() as { convexUrl?: unknown; convexDeviceKey?: unknown };
    return {
      ...next,
      convexUrl: clearedOptionalString(next.convexUrl, current.convexUrl),
      convexDeviceKey: clearedOptionalString(next.convexDeviceKey, current.convexDeviceKey),
    } as LassoSettings;
  };
  async function commit(
    next: LassoSettings,
    expectedAuthority?: LassoSettings,
  ): Promise<LassoSettings> {
    const authority = normalizeSettings(
      await store.write(storableSettings(next), expectedAuthority),
    );
    if (quarantinedMirror && !matchesQuarantinedMirror(authority)) {
      quarantinedMirror = null;
    }
    if (sameSettings(authority, next)) notify(authority);
    return authority;
  }

  async function get(): Promise<LassoSettings> {
    await migrateOnce();
    await store.hydrate();
    const stored = store.current();
    const current = withoutQuarantinedMirror(normalizeSettings(stored));
    const next = withStoredMirrorIdentity(current);
    const clearsStoredId =
      !mirrorConfigured(current) && Boolean(nonEmptyString(stored.mirrorConfigId));
    return sameSettings(normalizeSettings(stored), next) && !clearsStoredId
      ? current
      : commit(next, stored);
  }

  async function set(patch: Partial<LassoSettings>): Promise<LassoSettings> {
    // Merge over the cache (kept fresh by onExternalChange), not a fresh storage
    // read — deliberate, paired with the cached get(). Successive same-context
    // set()s see each other (write() updates the cache synchronously). The only
    // gap is a cross-context write to *another* field landing inside this context's
    // onChanged-propagation window: a last-write-wins race chrome.storage can't
    // avoid regardless (no atomic read-modify-write), and settings are user-paced.
    await migrateOnce();
    await store.hydrate();
    const current = withoutQuarantinedMirror(normalizeSettings(store.current()));
    const next = withPatchedMirrorIdentity(
      current,
      normalizeSettings({ ...store.current(), ...patch }),
    );
    const authority = await commit(next);
    // `syncedStore` may fence this write after a newer external value wins while
    // storage.set() is still settling. Report its authority, never our stale
    // requested snapshot.
    // The external bridge already notified a distinct winning Q. A matching
    // local echo is silent there, so this is its one notification.
    return authority;
  }

  function subscribe(cb: (s: LassoSettings) => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }

  // A write from another context (Options toggles a surface, popup flips a flag)
  // must reach this context's subscribers — e.g. the in-page surface manager.
  store.onExternalChange((raw, rawPrevious) => {
    const current = normalizeSettings(raw);
    const previous = normalizeSettings(rawPrevious);
    const reusesPriorId =
      mirrorConfigured(current) &&
      current.mirrorConfigId !== undefined &&
      !sameMirrorCredentials(previous, current) &&
      current.mirrorConfigId === previous.mirrorConfigId;
    if (reusesPriorId) quarantinedMirror = current;
    else if (quarantinedMirror && !matchesQuarantinedMirror(current)) {
      quarantinedMirror = null;
    }
    const safeCurrent = withoutQuarantinedMirror(current);
    let next: LassoSettings;
    try {
      next = withExternalMirrorIdentity(previous, safeCurrent);
    } catch {
      notify(safeCurrent);
      return;
    }
    const clearsStoredId =
      !mirrorConfigured(current) && Boolean(nonEmptyString(raw.mirrorConfigId));
    if (sameSettings(current, next) && !clearsStoredId) {
      notify(current);
      return;
    }

    // Quarantine the incoming identity immediately. This keeps every subscriber
    // truthful while the repaired synced value converges across contexts.
    const repair = store.write(next, raw);
    void repair.then(
      (rawAuthority) => {
        const authority = normalizeSettings(rawAuthority);
        if (quarantinedMirror && !matchesQuarantinedMirror(authority)) {
          quarantinedMirror = null;
        }
      },
      () => {
        const authority = normalizeSettings(store.current());
        if (sameSettings(authority, current)) {
          notify({ ...authority, mirrorConfigId: undefined });
        }
      },
    );
    notify(next);
  });

  return { get, set, subscribe };
}
