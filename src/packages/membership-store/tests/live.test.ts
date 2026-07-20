import { describe, expect, it, vi } from "vitest";

import type { LassoSettings, SettingsStore } from "@/core/settings";
import {
  createLiveMembershipStore,
  MirrorUnavailableError,
  type MirrorConfig,
} from "@/packages/membership-store/live";
import type {
  MembershipStore,
  MembershipSubject,
  MirrorSnapshot,
} from "@/packages/membership-store/types";

const owner = { userId: "1", screenName: "operator" };
const list = { id: "L1", name: "Research" };
const emptyObservation = { changes: [], ownerObservedAt: 123 };
const enabled: MirrorConfig = {
  convexUrl: "https://one.convex.cloud",
  convexDeviceKey: "key-1",
  mirrorConfigId: "mirror-1",
};

function settings() {
  const listeners = new Set<(next: LassoSettings) => void>();
  return {
    emit(next: MirrorConfig) {
      for (const listener of listeners) listener(next as LassoSettings);
    },
    store: {
      subscribe(listener: (next: LassoSettings) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

function throwingSettings() {
  return {
    store: {
      subscribe() {
        throw new Error("settings unavailable");
      },
    },
  };
}

function staleSettings() {
  let listener: ((next: LassoSettings) => void) | undefined;
  return {
    emit(next: MirrorConfig) {
      listener?.(next as LassoSettings);
    },
    store: {
      subscribe(next: (value: LassoSettings) => void) {
        listener = next;
        return () => {};
      },
    },
  };
}

function mirror() {
  let observer: ((snapshot: MirrorSnapshot) => void) | undefined;
  const stop = vi.fn();
  const store: MembershipStore = {
    recordAssign: vi.fn(async () => {}),
    reconcileAuthor: vi.fn(async () => {}),
    replaceCatalog: vi.fn(async () => {}),
    observe(_subject: MembershipSubject, emit: (snapshot: MirrorSnapshot) => void) {
      observer = emit;
      return stop;
    },
  };
  return { emit: (snapshot: MirrorSnapshot) => observer?.(snapshot), stop, store };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createLiveMembershipStore", () => {
  it("queues configured writes until its initial adapter is ready", async () => {
    const s = settings();
    const first = mirror();
    const ready = deferred<MembershipStore>();
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(() => ready.promise),
    );

    const write = live.recordAssign(owner, list, emptyObservation);
    expect(first.store.recordAssign).not.toHaveBeenCalled();

    ready.resolve(first.store);
    await write;
    expect(first.store.recordAssign).toHaveBeenCalledOnce();
  });

  it("stops retained writes immediately when Mirror settings are cleared", async () => {
    const s = settings();
    const first = mirror();
    const build = vi.fn(async () => first.store);
    const live = createLiveMembershipStore(enabled, s.store, build);
    await settle();

    await live.recordAssign(owner, list, emptyObservation);
    expect(first.store.recordAssign).toHaveBeenCalledOnce();
    expect(live.isConfigured()).toBe(true);

    s.emit({ convexUrl: enabled.convexUrl });
    await live.recordAssign(owner, list, emptyObservation);
    expect(first.store.recordAssign).toHaveBeenCalledOnce();
    expect(live.isConfigured()).toBe(false);
  });

  it("disconnects old observations, clears their view, and reconnects on a new config", async () => {
    const s = settings();
    const first = mirror();
    const second = mirror();
    const build = vi
      .fn<(_: MirrorConfig) => Promise<MembershipStore>>()
      .mockResolvedValueOnce(first.store)
      .mockResolvedValueOnce(second.store);
    const live = createLiveMembershipStore(enabled, s.store, build);
    await settle();

    const snapshots: MirrorSnapshot[] = [];
    live.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    first.emit({ catalog: [{ owner, lists: [list] }], memberships: [] });
    expect(snapshots).toHaveLength(1);

    s.emit({ convexUrl: "https://two.convex.cloud", convexDeviceKey: "key-2" });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(snapshots.at(-1)).toEqual({ catalog: [], memberships: [] });
    first.emit({ catalog: [{ owner, lists: [list] }], memberships: [] });
    expect(snapshots).toHaveLength(2);

    await settle();
    second.emit({
      catalog: [],
      memberships: [{ listId: "L1", ownerUserId: "1", present: true, lastSeenAt: 1 }],
    });
    expect(snapshots).toHaveLength(3);
    await live.recordAssign(owner, list, emptyObservation);
    expect(second.store.recordAssign).toHaveBeenCalledOnce();
  });

  it("fences a late old build after settings disable the Mirror", async () => {
    const s = settings();
    const first = mirror();
    let resolve!: (store: MembershipStore) => void;
    const build = vi.fn(
      () =>
        new Promise<MembershipStore>((done) => {
          resolve = done;
        }),
    );
    const live = createLiveMembershipStore(enabled, s.store, build);
    await Promise.resolve();

    s.emit({});
    resolve(first.store);
    await settle();
    await live.recordAssign(owner, list, emptyObservation);
    expect(first.store.recordAssign).not.toHaveBeenCalled();
  });

  it("fences a queued write when settings switch to another configured Mirror", async () => {
    const s = settings();
    const first = mirror();
    const second = mirror();
    const firstReady = deferred<MembershipStore>();
    const secondReady = deferred<MembershipStore>();
    const build = vi
      .fn<(_: MirrorConfig) => Promise<MembershipStore>>()
      .mockReturnValueOnce(firstReady.promise)
      .mockReturnValueOnce(secondReady.promise);
    const live = createLiveMembershipStore(enabled, s.store, build);
    const oldWrite = live.recordAssign(owner, list, emptyObservation);

    s.emit({ convexUrl: "https://two.convex.cloud", convexDeviceKey: "key-2" });
    firstReady.resolve(first.store);
    await expect(oldWrite).rejects.toBeInstanceOf(MirrorUnavailableError);
    expect(first.store.recordAssign).not.toHaveBeenCalled();

    secondReady.resolve(second.store);
    await settle();
    await live.recordAssign(owner, list, emptyObservation);
    expect(second.store.recordAssign).toHaveBeenCalledOnce();
  });

  it("exposes only the active configured Mirror identity", async () => {
    const s = settings();
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(async () => mirror().store),
    );
    await settle();
    expect(live.configurationId()).toBe("mirror-1");

    s.emit({
      convexUrl: enabled.convexUrl,
      convexDeviceKey: enabled.convexDeviceKey,
      mirrorConfigId: "mirror-2",
    });
    expect(live.configurationId()).toBe("mirror-2");

    s.emit({});
    expect(live.configurationId()).toBeNull();
    live.dispose();
    expect(live.configurationId()).toBeNull();
  });

  it("rejects a queued write when disposal cancels its configuration", async () => {
    const s = settings();
    const ready = deferred<MembershipStore>();
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(() => ready.promise),
    );
    const write = live.recordAssign(owner, list, emptyObservation);

    live.dispose();
    ready.resolve(mirror().store);

    await expect(write).rejects.toBeInstanceOf(MirrorUnavailableError);
  });

  it("rejects configured writes when adapter construction fails", async () => {
    const s = settings();
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(async () => {
        throw new Error("chunk missing");
      }),
    );
    await settle();

    expect(live.isConfigured()).toBe(true);
    await expect(live.recordAssign(owner, list, emptyObservation)).rejects.toBeInstanceOf(
      MirrorUnavailableError,
    );
    s.emit({});
    await expect(live.recordAssign(owner, list, emptyObservation)).resolves.toBeUndefined();
  });

  it("keeps the capability usable when view, observer, and cleanup callbacks throw", async () => {
    const s = settings();
    const brokenStop = vi.fn(() => {
      throw new Error("stop failed");
    });
    const brokenObserve = vi.fn(() => {
      throw new Error("observe failed");
    });
    const good = mirror();
    const first: MembershipStore = { ...good.store, observe: brokenObserve };
    const build = vi
      .fn<(_: MirrorConfig) => Promise<MembershipStore>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...good.store, observe: () => brokenStop });
    const live = createLiveMembershipStore(enabled, s.store, build);
    await settle();

    const stop = live.observe({ kind: "bulk" }, () => {
      throw new Error("view failed");
    });
    stop();
    stop();
    s.emit({ convexUrl: "https://two.convex.cloud", convexDeviceKey: "key-2" });
    await settle();
    await live.recordAssign(owner, list, emptyObservation);
    live.observe({ kind: "bulk" }, () => {
      throw new Error("view failed");
    });
    live.dispose();

    expect(brokenObserve).toHaveBeenCalledOnce();
    expect(brokenStop).toHaveBeenCalledOnce();
    expect(good.store.recordAssign).toHaveBeenCalledOnce();
  });

  it("publishes an empty view while unconfigured and tolerates bad settings cleanup", async () => {
    const snapshots: MirrorSnapshot[] = [];
    const unsubscribe = vi.fn(() => {
      throw new Error("unsubscribe failed");
    });
    const store = {
      subscribe() {
        return unsubscribe;
      },
    } as Pick<SettingsStore, "subscribe">;
    const live = createLiveMembershipStore({}, store, vi.fn());

    const stop = live.observe({ kind: "bulk" }, (snapshot) => snapshots.push(snapshot));
    live.observe({ kind: "bulk" }, () => {
      throw new Error("view failed");
    });
    stop();
    stop();
    live.dispose();
    live.dispose();

    expect(snapshots).toEqual([{ catalog: [], memberships: [] }]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(live.isConfigured()).toBe(false);
  });

  it("keeps configured startup fail-open when settings observation or a late build fails", async () => {
    const s = throwingSettings();
    let reject!: (reason?: unknown) => void;
    const pending = new Promise<MembershipStore>((_resolve, fail) => {
      reject = fail;
    });
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(() => pending),
    );
    await Promise.resolve();
    live.dispose();
    reject(new Error("late build failed"));
    await settle();

    expect(live.isConfigured()).toBe(false);
  });

  it("ignores repeat config and stale settings delivery after disposal", async () => {
    const s = staleSettings();
    const build = vi.fn(async () => mirror().store);
    const live = createLiveMembershipStore(enabled, s.store, build);
    await settle();
    s.emit(enabled);
    await settle();
    live.dispose();
    s.emit(enabled);

    expect(build).toHaveBeenCalledOnce();
  });

  it("dispatches both reconcile operations through a ready adapter", async () => {
    const s = settings();
    const ready = mirror();
    const live = createLiveMembershipStore(
      enabled,
      s.store,
      vi.fn(async () => ready.store),
    );
    await settle();

    await live.reconcileAuthor(
      owner,
      { screenName: "alice", identity: "user:7" },
      { listIds: ["L1"], observedAt: 123, ownerObservedAt: 122 },
    );
    await live.replaceCatalog(owner, { lists: [list], observedAt: 123, ownerObservedAt: 122 });

    expect(ready.store.reconcileAuthor).toHaveBeenCalledWith(
      owner,
      { screenName: "alice", identity: "user:7" },
      { listIds: ["L1"], observedAt: 123, ownerObservedAt: 122 },
    );
    expect(ready.store.replaceCatalog).toHaveBeenCalledWith(owner, {
      lists: [list],
      observedAt: 123,
      ownerObservedAt: 122,
    });
  });
});
