import { requestSettingsPatch, requestSettingsRead } from "@/core/protocol";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings,
  sameSettings,
  sameUserVisibleSettings,
  transitionSettings,
  type LassoSettings,
  type SettingsPatch,
} from "@/core/settings-domain";
import { localArea, type StorageLike } from "@/core/storage-areas";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { watchStorageKey } from "@/core/storage-sync";
import { syncedStore } from "@/core/synced-store";
import { hasWorkerTransport } from "@/core/worker-transport";

export type { StorageLike } from "@/core/storage-areas";
export {
  DEFAULT_SETTINGS,
  encodeSettings,
  MAX_CONVEX_DEVICE_KEY_LENGTH,
  MAX_CONVEX_URL_LENGTH,
  MAX_MIRROR_CONFIG_ID_LENGTH,
  MAX_PALETTE_HOTKEY_LENGTH,
  MAX_PILL_POSITION,
  MAX_SETTINGS_ID_LENGTH,
  mergeSettings,
  normalizeSettings,
  sameSettings,
  sameUserVisibleSettings,
  transitionSettings,
  type Activation,
  type BackendStrategy,
  type LassoSettings,
  type SettingsPatch,
  type SettingsTransition,
} from "@/core/settings-domain";

export type SettingsChangeOrigin = "local" | "external";

export interface SettingsStore {
  get(): Promise<LassoSettings>;
  set(patch: SettingsPatch): Promise<LassoSettings>;
  subscribe(cb: (settings: LassoSettings, origin?: SettingsChangeOrigin) => void): () => void;
}

type Listener = (settings: LassoSettings, origin?: SettingsChangeOrigin) => void;

const defaultMirrorConfigId = (): string => globalThis.crypto.randomUUID();

/**
 * Test and non-extension authority. It uses the same pure transition as the
 * worker; production contexts never receive this direct-storage path.
 */
function createInjectedSettings(
  storage: StorageLike,
  createMirrorConfigId: () => string,
): SettingsStore {
  const raw = syncedStore<Record<string, unknown>>(STORAGE_KEYS.settings, {}, storage, "local");
  const listeners = new Set<Listener>();
  let writes = Promise.resolve<unknown>(undefined);
  let current: LassoSettings | undefined;
  let stopWatching: (() => void) | undefined;

  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(operation, operation);
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const publish = (next: LassoSettings, origin: SettingsChangeOrigin): void => {
    const changed = current === undefined || !sameSettings(current, next);
    current = next;
    if (changed) for (const listener of listeners) listener(next, origin);
  };
  const read = async (): Promise<LassoSettings> => {
    await raw.hydrate();
    const before = raw.current();
    const transition = transitionSettings(before, createMirrorConfigId);
    if (!transition.changed) {
      current = transition.settings;
      return transition.settings;
    }
    const authority = await raw.write(transition.stored, before);
    const repaired = transitionSettings(authority, createMirrorConfigId);
    current = repaired.settings;
    return repaired.settings;
  };

  const repairExternal = (
    after: Record<string, unknown>,
    before: Record<string, unknown>,
  ): void => {
    const transition = transitionSettings(after, createMirrorConfigId, undefined, before);
    publish(transition.settings, "external");
    if (!transition.changed) return;
    void queue(async () => {
      await raw.write(transition.stored, after);
    }).catch(() => {});
  };
  const ensureWatching = (): void => {
    stopWatching ??= raw.onExternalChange(repairExternal);
  };

  return {
    get: () => queue(read),
    set: (patch) =>
      queue(async () => {
        await raw.hydrate();
        const before = raw.current();
        const transition = transitionSettings(before, createMirrorConfigId, patch);
        const authority = transition.changed ? await raw.write(transition.stored, before) : before;
        const next = transitionSettings(authority, createMirrorConfigId).settings;
        publish(next, sameSettings(next, transition.settings) ? "local" : "external");
        return next;
      }),
    subscribe(listener) {
      listeners.add(listener);
      ensureWatching();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopWatching?.();
          stopWatching = undefined;
        }
      };
    },
  };
}

/** Worker-backed client facade. The worker owns every production transition. */
function createWorkerSettings(): SettingsStore {
  const listeners = new Set<Listener>();
  const pending = new Set<LassoSettings>();
  let writes = Promise.resolve<unknown>(undefined);
  let current: LassoSettings | undefined;
  let externalEpoch = 0;
  let revision = 0;
  let stopWatching: (() => void) | undefined;

  const queue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writes.then(operation, operation);
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const publish = (next: LassoSettings, origin: SettingsChangeOrigin): void => {
    const changed = current === undefined || !sameSettings(current, next);
    current = next;
    if (!changed) return;
    revision += 1;
    for (const listener of listeners) listener(next, origin);
  };
  const receive = (raw: unknown): void => {
    const next = normalizeSettings(raw);
    const local = [...pending].some((expected) => sameUserVisibleSettings(expected, next));
    if (!local) externalEpoch += 1;
    publish(next, local ? "local" : "external");
  };
  const ensureWatching = (): void => {
    stopWatching ??= watchStorageKey("local", STORAGE_KEYS.settings, ({ newValue }) =>
      receive(newValue),
    );
  };

  return {
    async get() {
      const startedAt = revision;
      const snapshot = await requestSettingsRead();
      if (startedAt === revision || current === undefined) current = snapshot;
      return startedAt === revision || current === undefined ? snapshot : current;
    },
    set: (patch) =>
      queue(async () => {
        const expected = mergeSettings(current ?? DEFAULT_SETTINGS, patch);
        const startedAt = externalEpoch;
        pending.add(expected);
        try {
          const snapshot = await requestSettingsPatch(patch);
          if (
            externalEpoch !== startedAt &&
            current !== undefined &&
            !sameUserVisibleSettings(current, snapshot)
          ) {
            return current;
          }
          publish(snapshot, "local");
          return snapshot;
        } finally {
          pending.delete(expected);
        }
      }),
    subscribe(listener) {
      listeners.add(listener);
      ensureWatching();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopWatching?.();
          stopWatching = undefined;
        }
      };
    },
  };
}

/**
 * Production calls the worker's read/patch commands. An injected area keeps the
 * same domain transition available to tests and non-extension hosts.
 */
export function createSettings(
  area?: StorageLike,
  createMirrorConfigId: () => string = defaultMirrorConfigId,
): SettingsStore {
  if (area === undefined && hasWorkerTransport()) return createWorkerSettings();
  return createInjectedSettings(area ?? localArea(), createMirrorConfigId);
}
