import type { SettingsStore } from "@/core/settings";
import type { XList } from "@/core/x-client/types";

import type {
  CompleteCatalogSnapshot,
  MembershipPerson,
  MembershipStore,
  MembershipSubject,
  MirrorSnapshot,
  ObservedMembershipChanges,
  ObservedMembershipSnapshot,
  Owner,
} from "./types";

/** The two settings that choose the optional Mirror adapter. */
export interface MirrorConfig {
  convexUrl?: string;
  convexDeviceKey?: string;
  mirrorConfigId?: string;
}

export type MembershipStoreBuilder = (config: MirrorConfig) => Promise<MembershipStore>;

/** A configured Mirror could not be constructed. X still works without it. */
export class MirrorUnavailableError extends Error {
  constructor() {
    super("Lasso Mirror is unavailable.");
    this.name = "MirrorUnavailableError";
  }
}

/**
 * A live Mirror facade. Its small interface hides adapter replacement,
 * observation hand-off, stale-build fencing, and settings ownership.
 */
export interface LiveMembershipStore extends MembershipStore {
  /** Whether the current settings opt into a Mirror. This is not a connection check. */
  isConfigured(): boolean;
  /** Identity of the configured Mirror whose results may update shared status. */
  configurationId(): string | null;
  /** Stop settings observation and every forwarded Mirror observation. Idempotent. */
  dispose(): void;
}

interface Observation {
  active: boolean;
  emit(snapshot: MirrorSnapshot): void;
  revision: number;
  stop(): void;
  subject: MembershipSubject;
}

const noop = (): void => {};
const emptySnapshot = (): MirrorSnapshot => ({ catalog: [], memberships: [] });

const publish = (observation: Observation, snapshot: MirrorSnapshot): void => {
  try {
    observation.emit(snapshot);
  } catch {
    // A view callback cannot break the optional Mirror capability.
  }
};

const configOf = (settings: MirrorConfig): MirrorConfig => ({
  convexUrl: settings.convexUrl,
  convexDeviceKey: settings.convexDeviceKey,
  mirrorConfigId: settings.mirrorConfigId,
});

const sameConfig = (left: MirrorConfig, right: MirrorConfig): boolean =>
  left.convexUrl === right.convexUrl &&
  left.convexDeviceKey === right.convexDeviceKey &&
  left.mirrorConfigId === right.mirrorConfigId;

const configured = (config: MirrorConfig): boolean =>
  Boolean(config.convexUrl && config.convexDeviceKey);

/**
 * Makes an awake content capability follow the two Mirror settings. Replacing a
 * configuration first disconnects the old adapter and clears its cached view;
 * a late old build can never become active. A request that began before the
 * switch may finish, but no later request reaches that old adapter.
 */
export function createLiveMembershipStore(
  initial: MirrorConfig,
  settings: Pick<SettingsStore, "subscribe">,
  build: MembershipStoreBuilder,
): LiveMembershipStore {
  let active: MembershipStore | null = null;
  let current = configOf(initial);
  let disposed = false;
  let revision = 0;
  let loading: Promise<MembershipStore | null> | null = null;
  let unavailable: MirrorUnavailableError | null = null;
  const observations = new Set<Observation>();

  const disconnect = (observation: Observation): void => {
    const stop = observation.stop;
    observation.stop = noop;
    observation.revision = -1;
    try {
      stop();
    } catch {
      // A broken optional adapter must not retain this content capability.
    }
  };

  const connect = (observation: Observation): void => {
    /* v8 ignore next -- callers only connect live observations; disposal and stop disconnect them first. */
    if (disposed || !observation.active) return;
    if (!active) {
      publish(observation, emptySnapshot());
      return;
    }
    const connectionRevision = revision;
    observation.revision = connectionRevision;
    try {
      observation.stop = active.observe(observation.subject, (snapshot) => {
        if (
          !disposed &&
          observation.active &&
          observation.revision === connectionRevision &&
          revision === connectionRevision
        ) {
          publish(observation, snapshot);
        }
      });
    } catch {
      observation.stop = noop;
    }
  };

  const reconfigure = (next: MirrorConfig, force = false): void => {
    if (disposed || (!force && sameConfig(current, next))) return;
    current = configOf(next);
    const nextRevision = ++revision;
    const desired = configOf(current);
    active = null;
    loading = null;
    unavailable = null;

    for (const observation of observations) {
      disconnect(observation);
      publish(observation, emptySnapshot());
    }
    if (!configured(current)) return;

    const ready = Promise.resolve()
      .then(() => build(desired))
      .then((store) => {
        if (disposed || revision !== nextRevision) return null;
        active = store;
        for (const observation of observations) connect(observation);
        return store;
      })
      .catch(() => {
        if (!disposed && revision === nextRevision) unavailable = new MirrorUnavailableError();
        return null;
      });
    loading = ready;
  };

  let unsubscribe = noop;
  try {
    unsubscribe = settings.subscribe((next) => reconfigure(configOf(next)));
  } catch {
    // The content capability stays optional if settings observation is unavailable.
  }
  reconfigure(current, true);

  const dispatch = (operation: (store: MembershipStore) => Promise<void>): Promise<void> => {
    const operationRevision = revision;
    if (active) return operation(active);
    if (!configured(current)) return Promise.resolve();

    const ready = loading;
    /* v8 ignore next -- a configured facade creates its loading promise before it is returned. */
    if (!ready) return Promise.reject(unavailable ?? new MirrorUnavailableError());
    return ready.then((store) => {
      if (disposed || revision !== operationRevision || !configured(current)) {
        throw new MirrorUnavailableError();
      }
      /* v8 ignore next -- a current failed build records unavailable; stale null is fenced above. */
      if (!store) throw unavailable ?? new MirrorUnavailableError();
      return operation(store);
    });
  };

  return {
    recordAssign(owner: Owner, list: XList, observation: ObservedMembershipChanges): Promise<void> {
      return dispatch((store) => store.recordAssign(owner, list, observation));
    },
    reconcileAuthor(
      owner: Owner,
      person: MembershipPerson,
      snapshot: ObservedMembershipSnapshot,
    ): Promise<void> {
      return dispatch((store) => store.reconcileAuthor(owner, person, snapshot));
    },
    replaceCatalog(owner: Owner, snapshot: CompleteCatalogSnapshot): Promise<void> {
      return dispatch((store) => store.replaceCatalog(owner, snapshot));
    },
    observe(subject, emit) {
      const observation: Observation = {
        active: true,
        emit,
        revision: -1,
        stop: noop,
        subject,
      };
      observations.add(observation);
      connect(observation);
      return () => {
        if (!observation.active) return;
        observation.active = false;
        observations.delete(observation);
        disconnect(observation);
      };
    },
    isConfigured: () => !disposed && configured(current),
    configurationId: () =>
      !disposed && configured(current) && current.mirrorConfigId ? current.mirrorConfigId : null,
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      try {
        unsubscribe();
      } catch {
        // Settings cleanup is optional too.
      }
      for (const observation of observations) {
        observation.active = false;
        disconnect(observation);
      }
      observations.clear();
      active = null;
      loading = null;
      unavailable = null;
    },
  };
}
