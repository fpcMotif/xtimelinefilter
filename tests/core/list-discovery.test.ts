import { describe, expect, it, vi } from "vitest";

import { createListDiscovery, ListDiscoveryError } from "@/core/list-discovery";
import type { StorageLike } from "@/core/settings";
import { STORAGE_KEYS } from "@/core/storage-keys";
import { type Credentials, XApiError, type XList } from "@/core/x-client/types";

const KEY = STORAGE_KEYS.lists;
const creds: Credentials = { csrf: "ct0", bearer: "B" };
const flush = () => new Promise((r) => setTimeout(r, 0));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryStorage(
  seed: Record<string, unknown> = {},
): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...seed };
  return {
    data,
    async get(keys) {
      const key = keys as string;
      return key in data ? { [key]: data[key] } : {};
    },
    async set(items) {
      Object.assign(data, items);
    },
  };
}

const ownerships = (lists: Array<{ id_str: string; name: string; member_count?: number }>) => ({
  lists,
});

function makeDiscovery(opts: {
  fetch: typeof fetch;
  storage?: StorageLike;
  creds?: () => Credentials;
}) {
  return createListDiscovery({
    fetch: opts.fetch,
    creds: opts.creds ?? (() => creds),
    storage: opts.storage ?? memoryStorage(),
  });
}

describe("createListDiscovery — owned-List loading + cache", () => {
  it("loads owned Lists from the v1.1 ownerships endpoint when the cache is cold, and caches them", async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse(ownerships([{ id_str: "1", name: "Research", member_count: 3 }])),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    const lists = await discovery.ownedLists();
    expect(lists).toEqual([{ id: "1", name: "Research", memberCount: 3 }]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/i/api/1.1/lists/ownerships.json");
    expect(storage.data[KEY]).toEqual(lists);
  });

  it("shows the cache immediately, then delivers a silent background refresh once", async () => {
    const cached: XList[] = [{ id: "1", name: "Research" }];
    const storage = memoryStorage({ [KEY]: cached });
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        ownerships([
          { id_str: "1", name: "Research" },
          { id_str: "2", name: "Friends" },
        ]),
      ),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    const onRefresh = vi.fn();
    const shown = await discovery.ownedLists({ onRefresh });
    expect(shown).toEqual(cached); // instant, straight from cache

    await flush(); // background refresh reconciles with X
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls[0]?.[0].map((l: XList) => l.id)).toEqual(["1", "2"]);
    expect((storage.data[KEY] as XList[]).map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("drops an empty background refresh so it can't blank a populated picker", async () => {
    const cached: XList[] = [{ id: "1", name: "Research" }];
    const storage = memoryStorage({ [KEY]: cached });
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [] }));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    const onRefresh = vi.fn();
    await discovery.ownedLists({ onRefresh });
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("keeps the last-good cache and never throws when the background refresh fails", async () => {
    const cached: XList[] = [{ id: "1", name: "Research" }];
    const storage = memoryStorage({ [KEY]: cached });
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    const onRefresh = vi.fn();
    await expect(discovery.ownedLists({ onRefresh })).resolves.toEqual(cached);
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(storage.data[KEY]).toEqual(cached);
  });

  it("returns [] when the user has no Lists", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [] }));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.ownedLists()).resolves.toEqual([]);
  });

  it("refresh() always reloads and updates the cache", async () => {
    const storage = memoryStorage({ [KEY]: [{ id: "1", name: "Old" }] });
    const fetchMock = vi.fn(async () => jsonResponse(ownerships([{ id_str: "2", name: "New" }])));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    const lists = await discovery.refresh();
    expect(lists.map((l) => l.id)).toEqual(["2"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((storage.data[KEY] as XList[]).map((l) => l.id)).toEqual(["2"]);
  });
});

describe("createListDiscovery — the cache is an optimization, never a failure source", () => {
  it("returns the loaded Lists even when writing them to the cache fails", async () => {
    // chrome.storage.local.set rejects when the extension context is invalidated
    // (reload/update with a tab open) or on quota. The load itself succeeded.
    const storage: StorageLike = {
      async get() {
        return {};
      },
      async set() {
        throw new Error("Extension context invalidated.");
      },
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(ownerships([{ id_str: "1", name: "Research" }])),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    await expect(discovery.ownedLists()).resolves.toEqual([
      { id: "1", name: "Research", memberCount: undefined },
    ]);
  });

  it("treats an unreadable cache as a miss and loads from the network", async () => {
    const storage: StorageLike = {
      async get() {
        throw new Error("Extension context invalidated.");
      },
      async set() {},
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(ownerships([{ id_str: "1", name: "Research" }])),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch, storage });

    await expect(discovery.ownedLists()).resolves.toEqual([
      { id: "1", name: "Research", memberCount: undefined },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createListDiscovery — failure narrows to product-relevant kinds", () => {
  it("surfaces auth failures as a typed ListDiscoveryError", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.ownedLists()).rejects.toBeInstanceOf(ListDiscoveryError);
    await expect(discovery.ownedLists()).rejects.toMatchObject({ kind: "auth" });
  });

  it("surfaces rate-limited with the reset time", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "x-rate-limit-reset": "1750000123" } }),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.ownedLists()).rejects.toMatchObject({
      kind: "rate-limited",
      resetAt: 1750000123,
    });
  });

  it("hides transport detail behind kind 'unknown' for unexpected failures", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.ownedLists()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("maps a synchronous credentials failure (logged out) to a typed auth error without fetching", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [] }));
    const discovery = makeDiscovery({
      fetch: fetchMock as unknown as typeof fetch,
      creds: () => {
        throw new XApiError("auth", "Missing ct0");
      },
    });
    await expect(discovery.ownedLists()).rejects.toMatchObject({ kind: "auth" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("membership — best-effort 'already in' checks", () => {
  it("returns owned-List ids that already contain the person", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({ lists: [{ id_str: "9" }, { id_str: "12" }] }),
    );
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.membership("jane")).resolves.toEqual(["9", "12"]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/i/api/1.1/lists/memberships.json");
  });

  it("returns [] on any failure — never blocks the picker", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const discovery = makeDiscovery({ fetch: fetchMock as unknown as typeof fetch });
    await expect(discovery.membership("jane")).resolves.toEqual([]);
  });

  it("stays quiet when credentials throw synchronously (logged out)", async () => {
    const discovery = makeDiscovery({
      fetch: (async () => jsonResponse({})) as unknown as typeof fetch,
      creds: () => {
        throw new XApiError("auth", "Missing ct0");
      },
    });
    await expect(discovery.membership("jane")).resolves.toEqual([]);
  });
});
