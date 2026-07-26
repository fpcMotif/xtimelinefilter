import { describe, expect, it, vi } from "vitest";

import {
  createListCache,
  createWorkerListCatalogPort,
  isCachedList,
  listCacheOwnerKey,
  parseCachedOwnerCatalog,
  readCachedCatalog,
  type ListCatalogPort,
} from "@/core/list-cache";
import * as protocol from "@/core/protocol";
import type { Owner } from "@/packages/membership-store/types";
import type { XList } from "@/packages/x-client/types";

const A: Owner = { userId: "100", screenName: "alice" };
const B: Owner = { userId: "200", screenName: "bob" };
const A_LISTS: XList[] = [{ id: "1", name: "Research" }];

function catalogPort(overrides: Partial<ListCatalogPort> = {}): ListCatalogPort {
  return {
    read: vi.fn(async () => null),
    all: vi.fn(async () => []),
    begin: vi.fn(async () => ({ epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 })),
    commit: vi.fn(async (_owner, _token, lists) => lists),
    ...overrides,
  };
}

describe("createListCache", () => {
  it("uses the worker transport for each catalog operation", async () => {
    const sendMessage = vi.fn(async (request: { operation: string }) => {
      if (request.operation === "all")
        return { ok: true, catalogs: [{ owner: A, lists: A_LISTS }] };
      if (request.operation === "begin")
        return { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } };
      return { ok: true, lists: request.operation === "read" ? A_LISTS : [] };
    });
    const previous = globalThis.chrome;
    globalThis.chrome = { ...previous, runtime: { sendMessage } } as unknown as typeof chrome;
    try {
      const port = createWorkerListCatalogPort();

      await expect(port.read(A)).resolves.toEqual(A_LISTS);
      await expect(port.all()).resolves.toEqual([{ owner: A, lists: A_LISTS }]);
      await expect(port.begin(A)).resolves.toEqual({
        epoch: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
      });
      await expect(
        port.commit(A, { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }, []),
      ).resolves.toEqual([]);
      expect(sendMessage).toHaveBeenCalledTimes(4);
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("parses only safe Owner-qualified catalog rows", () => {
    const row = {
      schema: 2,
      owner: A,
      lists: A_LISTS,
      refreshedAt: 1,
      observation: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 0 },
    } as const;

    expect(parseCachedOwnerCatalog(null)).toBeNull();
    expect(parseCachedOwnerCatalog(row)).toEqual(row);
    expect(parseCachedOwnerCatalog({ ...row, owner: { ...A, userId: "0" } })).toBeNull();
    expect(parseCachedOwnerCatalog({ ...row, lists: [{ id: "1", name: " " }] })).toBeNull();
    expect(parseCachedOwnerCatalog({ ...row, refreshedAt: Number.POSITIVE_INFINITY })).toBeNull();
    expect(
      parseCachedOwnerCatalog({ ...row, observation: { epoch: "bad", sequence: 0 } }),
    ).toBeNull();
    expect(isCachedList({ id: "1", name: "List", memberCount: 0, isPrivate: false })).toBe(true);
    expect(isCachedList({ id: "0", name: "List", memberCount: -1, isPrivate: "no" })).toBe(false);
    expect(listCacheOwnerKey("a/b")).toBe("lasso:lists:a%2Fb");
  });

  it("reads through its catalog port", async () => {
    const port = catalogPort({ read: vi.fn(async () => A_LISTS) });
    const cache = createListCache(async () => A_LISTS, { catalog: port });

    await expect(cache.cached(A)).resolves.toEqual(A_LISTS);
    expect(port.read).toHaveBeenCalledWith(A);
  });

  it("replaces one Owner's cache with X's authoritative empty answer", async () => {
    const port = catalogPort();
    const cache = createListCache(async () => [], { catalog: port });

    await expect(cache.refresh(A)).resolves.toEqual([]);
    expect(port.commit).toHaveBeenCalledWith(A, expect.anything(), []);
  });

  it("loads without caching when Owner discovery is unavailable", async () => {
    const loader = vi.fn(async () => A_LISTS);
    const port = catalogPort();
    const cache = createListCache(loader, { catalog: port });

    await expect(cache.cached(null)).resolves.toBeNull();
    await expect(cache.refresh(null)).resolves.toEqual(A_LISTS);
    expect(port.begin).not.toHaveBeenCalled();
    expect(port.commit).not.toHaveBeenCalled();
  });

  it("uses its default worker catalog", async () => {
    const sendMessage = vi.fn(async (request: { operation: string }) =>
      request.operation === "begin"
        ? { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } }
        : { ok: true, lists: A_LISTS },
    );
    const previous = globalThis.chrome;
    globalThis.chrome = { ...previous, runtime: { sendMessage } } as unknown as typeof chrome;
    try {
      await expect(createListCache(async () => A_LISTS).refresh(A)).resolves.toEqual(A_LISTS);
    } finally {
      globalThis.chrome = previous;
    }
  });

  it("returns all worker catalogs for Options", async () => {
    const all = [{ owner: A, lists: A_LISTS }];
    await expect(readCachedCatalog(catalogPort({ all: vi.fn(async () => all) }))).resolves.toEqual(
      all,
    );
  });

  it("fails soft when the catalog worker is unavailable", async () => {
    const unavailable = catalogPort({
      read: vi.fn(async () => {
        throw new Error("down");
      }),
      all: vi.fn(async () => {
        throw new Error("down");
      }),
      begin: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const cache = createListCache(async () => A_LISTS, { catalog: unavailable });

    await expect(cache.cached(A)).resolves.toBeNull();
    await expect(cache.refresh(A)).resolves.toEqual(A_LISTS);
    await expect(readCachedCatalog(unavailable)).resolves.toEqual([]);
    expect(unavailable.commit).not.toHaveBeenCalled();
  });

  it("returns X's answer when the worker rejects a commit", async () => {
    const port = catalogPort({
      commit: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const cache = createListCache(async () => A_LISTS, { catalog: port });

    await expect(cache.refresh(A)).resolves.toEqual(A_LISTS);
  });

  it("uses the worker's winning row when another refresh wins the cache race", async () => {
    const winner: XList[] = [{ id: "2", name: "Newer" }];
    const port = catalogPort({ commit: vi.fn(async () => winner) });
    const cache = createListCache(async () => A_LISTS, { catalog: port });

    await expect(cache.refresh(A)).resolves.toEqual(winner);
  });

  it("keeps the fresh value when a winning cache row is absent", async () => {
    const port = catalogPort({ commit: vi.fn(async () => null) });
    await expect(
      createListCache(async () => A_LISTS, { catalog: port }).refresh(A),
    ).resolves.toEqual(A_LISTS);
  });

  it("rejects when Owner changes in the commit window", async () => {
    let reads = 0;
    const port = catalogPort();
    const cache = createListCache(async () => A_LISTS, {
      catalog: port,
      currentOwner: () => (reads++ === 0 ? A : B),
    });

    await expect(cache.refresh(A)).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
    expect(port.commit).not.toHaveBeenCalled();
  });

  it("rejects an anonymous refresh after Owner discovery", async () => {
    await expect(
      createListCache(async () => A_LISTS, { currentOwner: () => A }).refresh(null),
    ).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
  });

  it("defends worker-port response shape at every operation boundary", async () => {
    const request = vi.spyOn(protocol, "requestListCache");
    const port = createWorkerListCatalogPort();

    request.mockResolvedValueOnce({
      ok: true,
      token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 },
    });
    await expect(port.read(A)).resolves.toBeNull();
    request.mockResolvedValueOnce({ ok: true, lists: A_LISTS });
    await expect(port.all()).resolves.toEqual([]);
    request.mockResolvedValueOnce({ ok: true, lists: A_LISTS });
    await expect(port.begin(A)).rejects.toThrow("List cache token unavailable");
    request.mockResolvedValueOnce({
      ok: true,
      token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 },
    });
    await expect(
      port.commit(A, { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }, A_LISTS),
    ).resolves.toBeNull();
  });

  it("rejects an Owner's stale fetch before it reaches the worker", async () => {
    let resolve!: (lists: XList[]) => void;
    let currentOwner: Owner | null = A;
    const port = catalogPort();
    const cache = createListCache(() => new Promise((done) => (resolve = done)), {
      catalog: port,
      currentOwner: () => currentOwner,
    });

    const refresh = cache.refresh(A);
    await vi.waitFor(() => expect(port.begin).toHaveBeenCalledWith(A));
    currentOwner = B;
    resolve(A_LISTS);

    await expect(refresh).rejects.toMatchObject({ name: "ListCacheOwnerChangedError" });
    expect(port.commit).not.toHaveBeenCalled();
  });
});
