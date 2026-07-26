import type { BackendStrategy, SettingsStore } from "@/core/settings";

import { createXListApi, type XListApiRuntime } from "./factory";
import type { XListApi, XListApiSource } from "./types";

/** A settings-following adapter source for one awake content capability. */
export interface LiveXListApi extends XListApiSource {
  /** Stop settings observation. Safe to call more than once. */
  dispose(): void;
}

/**
 * Replaces the adapter after a backend settings change. Callers snapshot it at
 * the start of a user action, so a paced run cannot mix adapters mid-flight.
 */
export function createLiveXListApi(
  initial: BackendStrategy,
  settings: Pick<SettingsStore, "subscribe">,
  runtime: XListApiRuntime,
): LiveXListApi {
  let strategy = initial;
  let current: XListApi = createXListApi(strategy, runtime);
  let disposed = false;
  const unsubscribe = settings.subscribe((next) => {
    if (disposed || next.backend === strategy) return;
    const replacement = createXListApi(next.backend, runtime);
    strategy = next.backend;
    current = replacement;
  });

  return {
    snapshot: () => current,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
    },
  };
}
