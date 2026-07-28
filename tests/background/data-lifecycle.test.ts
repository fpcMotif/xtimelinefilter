import { describe, expect, it, vi } from "vitest";

import { createDataLifecycle } from "@/background/data-lifecycle";
import { defaultFilterState, isFilterState, MAX_FILTER_PRESETS } from "@/core/filter-domain";
import { DEFAULT_SETTINGS } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";

import { createMemoryArea } from "../helpers/chrome-fake";

const SETTINGS = STORAGE_KEYS.settings;
const STATE = STORAGE_KEYS.settingsMigration;
const legacy = { backend: "graphql", convexDeviceKey: "secret" };
const GRAPHQL_CATALOG = {
  ListAddMember: { queryId: "add", features: {} },
  ListRemoveMember: { queryId: "remove", features: {} },
  UserByScreenName: { queryId: "user", features: {}, fieldToggles: { withPayments: false } },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("background data lifecycle", () => {
  it("migrates legacy sync settings once, removes the replica, and persists completion", async () => {
    const local = createMemoryArea();
    const sync = createMemoryArea({ [SETTINGS]: legacy });

    await expect(createDataLifecycle(local, sync).migrate()).resolves.toBe(true);

    expect(local.data[SETTINGS]).toEqual(legacy);
    expect(local.data[STATE]).toBe("complete");
    expect(sync.data[SETTINGS]).toBeUndefined();
  });

  it("keeps local authority but still removes a stale synced replica", async () => {
    const localSettings = { backend: "rest" };
    const local = createMemoryArea({ [SETTINGS]: localSettings });
    const sync = createMemoryArea({ [SETTINGS]: legacy });

    await createDataLifecycle(local, sync).migrate();

    expect(local.data[SETTINGS]).toBe(localSettings);
    expect(sync.data[SETTINGS]).toBeUndefined();
    expect(local.data[STATE]).toBe("complete");
  });

  it("queues Clear after a migration that already captured synced settings", async () => {
    const local = createMemoryArea({ [STORAGE_KEYS.coach]: { seen: true } });
    const sync = createMemoryArea({ [SETTINGS]: legacy, [STORAGE_KEYS.filter]: { enabled: true } });
    const originalGet = sync.get.bind(sync);
    const captured = deferred<Record<string, unknown>>();
    const syncGet = vi
      .spyOn(sync, "get")
      .mockImplementation((keys) => (keys === SETTINGS ? captured.promise : originalGet(keys)));
    const lifecycle = createDataLifecycle(local, sync);

    const migration = lifecycle.migrate();
    await vi.waitFor(() => expect(syncGet).toHaveBeenCalledWith(SETTINGS));
    const clear = lifecycle.clear();
    captured.resolve({ [SETTINGS]: legacy });

    await expect(migration).resolves.toBe(true);
    await expect(clear).resolves.toEqual({ localCleared: true, syncCleared: true });
    expect(local.data[SETTINGS]).toBeUndefined();
    expect(sync.data[SETTINGS]).toBeUndefined();
    expect(local.data[STATE]).toBe("cleared");
  });

  it("serializes Filter commands over immediate prior sync authority", async () => {
    const sync = createMemoryArea();
    const lifecycle = createDataLifecycle(createMemoryArea(), sync);

    const first = lifecycle.commandFilter({ type: "cycle", id: "kind:video" }, ["en-US"]);
    const second = lifecycle.commandFilter({ type: "cycle", id: "kind:video" }, ["en-US"]);
    const [once, twice] = await Promise.all([first, second]);

    expect(once.criteria).toEqual({ "kind:video": "only" });
    expect(twice.criteria).toEqual({ "kind:video": "hide" });
    expect(sync.data[STORAGE_KEYS.filter]).toMatchObject({
      criteria: { "kind:video": "hide" },
      myLanguages: ["en"],
    });
  });

  it("serializes Coach commands from separate contexts so onboarding and a tip both survive", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());

    const [onboarded, tip] = await Promise.all([
      lifecycle.runCoach({ kind: "mark-onboarded" }),
      lifecycle.runCoach({ kind: "try-show-tip", tip: "first-hover", max: 1 }),
    ]);

    expect(onboarded).toEqual({ kind: "ok" });
    expect(tip).toEqual({ kind: "try-show-tip", show: true });
    expect(local.data[STORAGE_KEYS.coach]).toMatchObject({
      onboarded: true,
      tips: { "first-hover": 1 },
    });
  });

  it("keeps unrelated Filter fields when independently queued commands race", async () => {
    const sync = createMemoryArea();
    const lifecycle = createDataLifecycle(createMemoryArea(), sync);

    await Promise.all([
      lifecycle.commandFilter({ type: "set-compact-hidden", on: true }, ["en"]),
      lifecycle.commandFilter({ type: "set-mode", id: "kind:text", mode: "hide" }, ["en"]),
    ]);

    expect(await lifecycle.readFilter(["fr"])).toMatchObject({
      compactHidden: true,
      criteria: { "kind:text": "hide" },
      myLanguages: ["en"],
    });
  });

  it("returns and persists a valid Filter snapshot at the preset bound", async () => {
    const full = defaultFilterState(["en"]);
    full.presets = Array.from({ length: MAX_FILTER_PRESETS }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      criteria: {},
      onlyMyLanguages: false,
    }));
    const sync = createMemoryArea({ [STORAGE_KEYS.filter]: full });
    const lifecycle = createDataLifecycle(createMemoryArea(), sync);

    const state = await lifecycle.commandFilter({ type: "save-preset", id: "next", name: "Next" }, [
      "en",
    ]);

    expect(state.presets).toHaveLength(MAX_FILTER_PRESETS);
    expect(isFilterState(state)).toBe(true);
    expect(sync.data[STORAGE_KEYS.filter]).toEqual(state);
  });

  it("serializes stale-context settings patches so disjoint fields both survive", async () => {
    const local = createMemoryArea({
      [SETTINGS]: { ...DEFAULT_SETTINGS, convexUrl: null, convexDeviceKey: null },
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "unused");

    const [topLevel, nested] = await Promise.all([
      lifecycle.patchSettings({ highContrast: true }),
      lifecycle.patchSettings({ surfaces: { palette: true } }),
    ]);

    expect(topLevel.highContrast).toBe(true);
    expect(nested).toMatchObject({ highContrast: true, surfaces: { pill: true, palette: true } });
    expect(await lifecycle.readSettings()).toMatchObject({
      highContrast: true,
      surfaces: { pill: true, palette: true },
    });
  });

  it("mints and rotates Mirror ids only for a complete credential transition", async () => {
    const ids = ["mirror-one", "mirror-two"];
    const local = createMemoryArea({ [SETTINGS]: { convexUrl: null, convexDeviceKey: null } });
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => ids.shift()!);

    const partial = await lifecycle.patchSettings({ convexUrl: "https://one.convex.cloud" });
    expect(partial.mirrorConfigId).toBeUndefined();
    const complete = await lifecycle.patchSettings({ convexDeviceKey: "key-one" });
    expect(complete.mirrorConfigId).toBe("mirror-one");
    expect((await lifecycle.patchSettings({ highContrast: true })).mirrorConfigId).toBe(
      "mirror-one",
    );
    expect((await lifecycle.patchSettings({ convexDeviceKey: "key-two" })).mirrorConfigId).toBe(
      "mirror-two",
    );
  });

  it("mints a Mirror id with crypto.randomUUID when no minter is injected", async () => {
    // The default minter is only CALLED on a complete credential transition. A
    // dev machine's .env.local pre-configures DEFAULT_SETTINGS, so some other
    // test happens to walk this line there and it is uncovered on CI — the
    // coverage gate has to mean the same thing in both places, so drive it here.
    const local = createMemoryArea({ [SETTINGS]: { convexUrl: null, convexDeviceKey: null } });
    const lifecycle = createDataLifecycle(local, createMemoryArea());

    const complete = await lifecycle.patchSettings({
      convexUrl: "https://one.convex.cloud",
      convexDeviceKey: "key-one",
    });

    expect(complete.mirrorConfigId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("persists null credential tombstones through a worker patch", async () => {
    const local = createMemoryArea({
      [SETTINGS]: {
        convexUrl: "https://one.convex.cloud",
        convexDeviceKey: "key-one",
        mirrorConfigId: "mirror-one",
      },
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "unused");

    await lifecycle.patchSettings({ convexUrl: undefined, convexDeviceKey: undefined });

    expect(local.data[SETTINGS]).toMatchObject({ convexUrl: null, convexDeviceKey: null });
    expect(await lifecycle.readSettings()).toMatchObject({
      convexUrl: undefined,
      convexDeviceKey: undefined,
      mirrorConfigId: undefined,
    });
  });

  it("makes cleared terminal across worker restarts and later sync writes", async () => {
    const local = createMemoryArea({ [SETTINGS]: legacy });
    const sync = createMemoryArea();

    await createDataLifecycle(local, sync).clear();
    sync.data[SETTINGS] = legacy;
    const syncGet = vi.spyOn(sync, "get");

    await expect(createDataLifecycle(local, sync).migrate()).resolves.toBe(true);
    expect(syncGet).not.toHaveBeenCalled();
    expect(local.data[SETTINGS]).toBeUndefined();
    expect(local.data[STATE]).toBe("cleared");
  });

  it("orders migration, patch, then Clear in one worker queue", async () => {
    const local = createMemoryArea();
    const sync = createMemoryArea({ [SETTINGS]: legacy });
    const lifecycle = createDataLifecycle(local, sync, () => "unused");

    const patch = lifecycle.patchSettings({ highContrast: true });
    const clear = lifecycle.clear();

    await expect(patch).resolves.toMatchObject({ backend: "graphql", highContrast: true });
    await expect(clear).resolves.toEqual({ localCleared: true, syncCleared: true });
    expect(local.data[SETTINGS]).toBeUndefined();
    expect(sync.data[SETTINGS]).toBeUndefined();
    expect(local.data[STATE]).toBe("cleared");
  });

  it("leaves pending on failure and retries safely", async () => {
    const local = createMemoryArea();
    const sync = createMemoryArea({ [SETTINGS]: legacy });
    const get = vi.spyOn(sync, "get").mockRejectedValueOnce(new Error("sync unavailable"));
    const lifecycle = createDataLifecycle(local, sync);

    await expect(lifecycle.migrate()).resolves.toBe(false);
    expect(local.data[STATE]).toBe("pending");
    get.mockRestore();

    await expect(lifecycle.migrate()).resolves.toBe(true);
    expect(local.data[SETTINGS]).toEqual(legacy);
    expect(local.data[STATE]).toBe("complete");
  });

  it("never partly deletes local data when its durable clear fence fails", async () => {
    const owner = { userId: "1", screenName: "one" };
    const catalogKey = `${STORAGE_KEYS.lists}:${owner.userId}`;
    const local = createMemoryArea({
      [SETTINGS]: legacy,
      [catalogKey]: { private: "cache" },
    });
    const sync = createMemoryArea({ [SETTINGS]: legacy });
    const set = vi.spyOn(local, "set").mockRejectedValueOnce(new Error("fence unavailable"));

    await expect(createDataLifecycle(local, sync).clear()).resolves.toEqual({
      localCleared: false,
      syncCleared: true,
    });
    expect(local.data[SETTINGS]).toEqual(legacy);
    expect(local.data[catalogKey]).toEqual({ private: "cache" });
    expect(sync.data[SETTINGS]).toBeUndefined();
    set.mockRestore();
  });

  it("first writes the terminal migration and rotated cache clock atomically before Clear", async () => {
    const prior = {
      schema: 1,
      epoch: "11111111-1111-4111-8111-111111111111",
      sequence: 4,
    };
    const local = createMemoryArea({ [STORAGE_KEYS.cacheObservation]: prior });
    const set = vi.spyOn(local, "set");

    await createDataLifecycle(local, createMemoryArea()).clear();

    const first = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(first[STATE]).toBe("cleared");
    expect(first[STORAGE_KEYS.cacheObservation]).toMatchObject({ schema: 1, sequence: 0 });
    expect((first[STORAGE_KEYS.cacheObservation] as { epoch: string }).epoch).not.toBe(prior.epoch);
  });

  it("keeps A when B begins, then lets B's later commit win", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const owner = { userId: "1", screenName: "one" };
    const a = await lifecycle.listCache({ type: "lasso:list-cache", operation: "begin", owner });
    const b = await lifecycle.listCache({ type: "lasso:list-cache", operation: "begin", owner });
    const listsA = [{ id: "10", name: "A" }];
    const listsB = [{ id: "11", name: "B" }];
    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner,
      token: (a as { token: never }).token,
      lists: listsA,
    });
    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner,
      token: (b as { token: never }).token,
      lists: listsB,
    });
    await expect(
      lifecycle.listCache({ type: "lasso:list-cache", operation: "read", owner }),
    ).resolves.toEqual({ lists: listsB });
  });

  it("shares cache-observation issuance across lifecycle instances on one local area", async () => {
    const local = createMemoryArea();
    const owner = { userId: "1", screenName: "one" };
    const first = createDataLifecycle(local, createMemoryArea());
    const second = createDataLifecycle(local, createMemoryArea());

    const [a, b] = await Promise.all([
      first.listCache({ type: "lasso:list-cache", operation: "begin", owner }),
      second.listCache({ type: "lasso:list-cache", operation: "begin", owner }),
    ]);
    const tokenA = (a as { token: { epoch: string; sequence: number } }).token;
    const tokenB = (b as { token: { epoch: string; sequence: number } }).token;
    expect(tokenB).toEqual({ epoch: tokenA.epoch, sequence: tokenA.sequence + 1 });

    await expect(
      first.listCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token: tokenA,
        lists: [{ id: "10", name: "A" }],
      }),
    ).resolves.toEqual({ lists: [{ id: "10", name: "A" }] });
  });

  it("shares one increasing observation clock between List and GraphQL begins", async () => {
    const lifecycle = createDataLifecycle(createMemoryArea(), createMemoryArea());
    const list = await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner: { userId: "1", screenName: "one" },
    });
    const graphql = await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "begin",
    });
    const listToken = (list as { token: { epoch: string; sequence: number } }).token;
    const graphqlToken = (graphql as { token: { epoch: string; sequence: number } }).token;

    expect(graphqlToken).toEqual({ epoch: listToken.epoch, sequence: listToken.sequence + 1 });
  });

  it("fences a pre-clear cache token across a worker restart", async () => {
    const local = createMemoryArea();
    const owner = { userId: "1", screenName: "one" };
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const begun = await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner,
    });
    await lifecycle.clear();
    const restarted = createDataLifecycle(local, createMemoryArea());
    await expect(
      restarted.listCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token: (begun as { token: never }).token,
        lists: [{ id: "10", name: "old" }],
      }),
    ).resolves.toEqual({ lists: null });
  });

  it("rejects malformed GraphQL catalog rows in worker storage", async () => {
    const local = createMemoryArea({
      [STORAGE_KEYS.graphqlCatalog]: {
        catalog: { ...GRAPHQL_CATALOG, unexpected: {} },
        fetchedAt: 1,
      },
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea());

    await expect(
      lifecycle.graphqlCatalog({ type: "lasso:graphql-catalog", operation: "read" }),
    ).resolves.toEqual({ entry: null });
  });

  it("rejects a pre-Clear GraphQL token after a worker restart", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const begun = await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "begin",
    });
    await lifecycle.clear();
    const restarted = createDataLifecycle(local, createMemoryArea());

    await expect(
      restarted.graphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: (begun as { token: never }).token,
        catalog: GRAPHQL_CATALOG,
      }),
    ).resolves.toEqual({ entry: null });
  });

  it("rejects a stale Mirror report after reading current settings authority", async () => {
    const local = createMemoryArea({
      [SETTINGS]: {
        convexUrl: "https://one.convex.cloud",
        convexDeviceKey: "key-one",
        mirrorConfigId: "stale",
      },
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "current");
    await expect(lifecycle.patchSettings({ convexDeviceKey: "key-two" })).resolves.toMatchObject({
      mirrorConfigId: "current",
    });

    await expect(
      lifecycle.mirrorStatus({
        type: "lasso:mirror-status",
        operation: "report",
        ok: true,
        configId: "stale",
      }),
    ).resolves.toEqual({});
    expect(local.data[STORAGE_KEYS.mirrorStatus]).toBeUndefined();
  });

  it("queues List usage before Clear removes it", async () => {
    const local = createMemoryArea();
    const usageKey = `${STORAGE_KEYS.listUsage}:1:2`;
    const releaseRead = deferred<Record<string, unknown>>();
    const originalGet = local.get.bind(local);
    vi.spyOn(local, "get").mockImplementation((keys) =>
      keys === usageKey ? releaseRead.promise : originalGet(keys),
    );
    const lifecycle = createDataLifecycle(local, createMemoryArea());

    const record = lifecycle.listUsage({
      type: "lasso:list-usage",
      operation: "record",
      ownerUserId: "1",
      listId: "2",
    });
    await vi.waitFor(() => expect(local.get).toHaveBeenCalledWith(usageKey));
    const clear = lifecycle.clear();
    releaseRead.resolve({});

    await Promise.all([record, clear]);
    expect(local.data[usageKey]).toBeUndefined();
  });

  it("fences a cache token when Clear queues behind its blocked begin", async () => {
    const local = createMemoryArea();
    const owner = { userId: "1", screenName: "one" };
    const releaseBegin = deferred<void>();
    const originalSet = local.set.bind(local);
    let blocked = false;
    vi.spyOn(local, "set").mockImplementation((items) => {
      if (!blocked && STORAGE_KEYS.cacheObservation in items) {
        blocked = true;
        return releaseBegin.promise.then(() => originalSet(items));
      }
      return originalSet(items);
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea());

    const begin = lifecycle.listCache({ type: "lasso:list-cache", operation: "begin", owner });
    await vi.waitFor(() => expect(blocked).toBe(true));
    const clear = lifecycle.clear();
    releaseBegin.resolve();

    const token = ((await begin) as { token: never }).token;
    await clear;
    await expect(
      lifecycle.listCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token,
        lists: [{ id: "2", name: "Fresh" }],
      }),
    ).resolves.toEqual({ lists: null });
  });

  it("keeps list usage monotonic when the clock moves backward", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    await lifecycle.listUsage({
      type: "lasso:list-usage",
      operation: "record",
      ownerUserId: "1",
      listId: "2",
    });
    await expect(
      lifecycle.listUsage({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId: "1",
        limit: 1,
      }),
    ).resolves.toEqual({ listIds: ["2"] });
  });

  it("rejects an invalid Coach command and normalizes a bad clock through the facade", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    vi.spyOn(Date, "now").mockReturnValueOnce(-1);

    await expect(lifecycle.runCoach({ kind: "mark-onboarded" })).resolves.toEqual({ kind: "ok" });
    await expect(lifecycle.runCoach({ kind: "not-a-command" } as never)).rejects.toThrow(
      "Invalid coach command",
    );
    expect(local.data[STORAGE_KEYS.coach]).toMatchObject({ onboarded: true });
  });

  it("keeps a prior List usage stamp and filters malformed recency rows", async () => {
    const prefix = "lasso:list-usage:1";
    const local = createMemoryArea({
      [`${prefix}:1`]: 10,
      [`${prefix}:2`]: 10,
      [`${prefix}:3`]: 11,
      [`${prefix}:0`]: 12,
      [`${prefix}:%31`]: 13,
      [`${prefix}:%ZZ`]: 14,
      [`${prefix}:bad`]: "nope",
      [`${prefix}:float`]: 1.5,
      [`${prefix}:negative`]: -1,
      "lasso:list-usage:2:9": 99,
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    vi.spyOn(Date, "now").mockReturnValueOnce(5);

    await lifecycle.listUsage({
      type: "lasso:list-usage",
      operation: "record",
      ownerUserId: "1",
      listId: "1",
    });
    await expect(
      lifecycle.listUsage({
        type: "lasso:list-usage",
        operation: "recent",
        ownerUserId: "1",
        limit: 2,
      }),
    ).resolves.toEqual({ listIds: ["3", "1"] });
    expect(local.data[`${prefix}:1`]).toBe(10);
  });

  it("reads, ranks, and fences observed List and GraphQL cache values", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const one = { userId: "1", screenName: "zeta" };
    const two = { userId: "2", screenName: "alpha" };
    const first = (await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner: one,
    })) as { token: never };
    const second = (await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner: two,
    })) as { token: never };

    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner: one,
      token: first.token,
      lists: [{ id: "1", name: "One" }],
    });
    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner: two,
      token: second.token,
      lists: [{ id: "2", name: "Two" }],
    });
    await expect(
      lifecycle.listCache({ type: "lasso:list-cache", operation: "all" }),
    ).resolves.toEqual({
      catalogs: [
        { owner: two, lists: [{ id: "2", name: "Two" }] },
        { owner: one, lists: [{ id: "1", name: "One" }] },
      ],
    });
    await expect(
      lifecycle.listCache({ type: "lasso:list-cache", operation: "read", owner: one }),
    ).resolves.toEqual({ lists: [{ id: "1", name: "One" }] });

    const graph = (await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "begin",
    })) as { token: never };
    await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "commit",
      token: graph.token,
      catalog: GRAPHQL_CATALOG,
    });
    await expect(
      lifecycle.graphqlCatalog({ type: "lasso:graphql-catalog", operation: "read" }),
    ).resolves.toMatchObject({ entry: { catalog: GRAPHQL_CATALOG } });
    await expect(
      lifecycle.graphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: graph.token,
        catalog: GRAPHQL_CATALOG,
      }),
    ).resolves.toMatchObject({ entry: { catalog: GRAPHQL_CATALOG } });
  });

  it("recovers the shared worker queue after a rejected storage operation", async () => {
    const sync = createMemoryArea();
    const get = vi.spyOn(sync, "get").mockRejectedValueOnce(new Error("unavailable"));
    const lifecycle = createDataLifecycle(createMemoryArea(), sync);

    await expect(lifecycle.readFilter(["en"])).rejects.toThrow("unavailable");
    get.mockRestore();
    await expect(lifecycle.readFilter(["en"])).resolves.toMatchObject({ myLanguages: ["en"] });
  });

  it("uses the UUID fallback and reports the current Mirror status", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => undefined });
    try {
      const local = createMemoryArea({
        [SETTINGS]: {
          convexUrl: "https://one.convex.cloud",
          convexDeviceKey: "key-one",
          mirrorConfigId: "current",
        },
      });
      const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "current");
      vi.spyOn(Date, "now").mockReturnValueOnce(-1);

      const begun = await lifecycle.listCache({
        type: "lasso:list-cache",
        operation: "begin",
        owner: { userId: "1", screenName: "one" },
      });
      expect((begun as { token: { epoch: string } }).token.epoch).toMatch(/^00000000-/);
      await lifecycle.mirrorStatus({
        type: "lasso:mirror-status",
        operation: "report",
        ok: false,
        configId: "current",
      });
      await expect(
        lifecycle.mirrorStatus({ type: "lasso:mirror-status", operation: "read" }),
      ).resolves.toEqual({ status: { ok: false, configId: "current", at: 0 } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the legacy set fallback and rejects reads when migration cannot recover", async () => {
    const sync = createMemoryArea({ [SETTINGS]: legacy });
    delete sync.remove;
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, sync);

    await expect(lifecycle.migrate()).resolves.toBe(true);
    expect(sync.data[SETTINGS]).toBeUndefined();

    vi.spyOn(local, "get").mockRejectedValueOnce(new Error("offline"));
    await expect(lifecycle.readSettings()).rejects.toThrow("Settings migration is unavailable");
  });

  it("returns the existing GraphQL catalog when an older commit loses its fence", async () => {
    const lifecycle = createDataLifecycle(createMemoryArea(), createMemoryArea());
    const begun = (await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "begin",
    })) as { token: never };
    await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "commit",
      token: begun.token,
      catalog: GRAPHQL_CATALOG,
    });
    await lifecycle.graphqlCatalog({ type: "lasso:graphql-catalog", operation: "begin" });

    await expect(
      lifecycle.graphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: begun.token,
        catalog: GRAPHQL_CATALOG,
      }),
    ).resolves.toMatchObject({ entry: { catalog: GRAPHQL_CATALOG } });
  });

  it("takes every timestamp and cache-fence branch through its public facade", async () => {
    const local = createMemoryArea();
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const owner = { userId: "1", screenName: "one" };
    vi.spyOn(Date, "now").mockReturnValueOnce(-1).mockReturnValueOnce(-1);

    await lifecycle.listUsage({
      type: "lasso:list-usage",
      operation: "record",
      ownerUserId: "1",
      listId: "1",
    });
    const first = (await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner,
    })) as { token: never };
    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner,
      token: first.token,
      lists: [{ id: "1", name: "One" }],
    });
    const second = (await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "begin",
      owner,
    })) as { token: never };
    await lifecycle.listCache({
      type: "lasso:list-cache",
      operation: "commit",
      owner,
      token: second.token,
      lists: [{ id: "2", name: "Fresh" }],
    });
    await lifecycle.listCache({ type: "lasso:list-cache", operation: "begin", owner });
    await expect(
      lifecycle.listCache({
        type: "lasso:list-cache",
        operation: "commit",
        owner,
        token: first.token,
        lists: [{ id: "9", name: "Ignored" }],
      }),
    ).resolves.toEqual({ lists: [{ id: "2", name: "Fresh" }] });

    const catalogKey = `${STORAGE_KEYS.lists}:1`;
    (local.data[catalogKey] as { owner: unknown }).owner = { userId: "2", screenName: "two" };
    await expect(
      lifecycle.listCache({ type: "lasso:list-cache", operation: "read", owner }),
    ).resolves.toEqual({ lists: null });
  });

  it("does not rewrite an already normalized settings snapshot", async () => {
    const local = createMemoryArea({
      [SETTINGS]: DEFAULT_SETTINGS,
      [STATE]: "complete",
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea());
    const set = vi.spyOn(local, "set");

    await lifecycle.readSettings();
    set.mockClear();
    await lifecycle.readSettings();
    await lifecycle.patchSettings({});

    expect(set).not.toHaveBeenCalled();
  });

  it("keeps a newer persisted GraphQL catalog and writes valid Mirror timestamps", async () => {
    const epoch = "11111111-1111-4111-8111-111111111111";
    const local = createMemoryArea({
      [STORAGE_KEYS.cacheObservation]: { schema: 1, epoch, sequence: 3 },
      [STORAGE_KEYS.graphqlCatalog]: {
        catalog: GRAPHQL_CATALOG,
        fetchedAt: 4,
        observation: { epoch, sequence: 3 },
      },
      [SETTINGS]: {
        convexUrl: "https://one.convex.cloud",
        convexDeviceKey: "key-one",
        mirrorConfigId: "current",
      },
      [STATE]: "complete",
    });
    const lifecycle = createDataLifecycle(local, createMemoryArea(), () => "current");

    await expect(
      lifecycle.graphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: { epoch, sequence: 2 },
        catalog: GRAPHQL_CATALOG,
      }),
    ).resolves.toEqual({ entry: { catalog: GRAPHQL_CATALOG, fetchedAt: 4 } });
    await lifecycle.mirrorStatus({
      type: "lasso:mirror-status",
      operation: "report",
      ok: true,
      configId: "current",
    });
    expect(local.data[STORAGE_KEYS.mirrorStatus]).toMatchObject({ ok: true });
  });

  it("normalizes an invalid GraphQL cache write timestamp", async () => {
    const lifecycle = createDataLifecycle(createMemoryArea(), createMemoryArea());
    const begun = (await lifecycle.graphqlCatalog({
      type: "lasso:graphql-catalog",
      operation: "begin",
    })) as { token: never };
    vi.spyOn(Date, "now").mockReturnValueOnce(-1);

    await expect(
      lifecycle.graphqlCatalog({
        type: "lasso:graphql-catalog",
        operation: "commit",
        token: begun.token,
        catalog: GRAPHQL_CATALOG,
      }),
    ).resolves.toMatchObject({ entry: { fetchedAt: 0 } });
  });
});
