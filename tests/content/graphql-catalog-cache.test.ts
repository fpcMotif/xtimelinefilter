import { describe, expect, it, vi } from "vitest";

import { createChromeCatalogCache } from "@/content/graphql-catalog-cache";

const H = vi.hoisted(() => ({ requestGraphqlCatalog: vi.fn() }));

vi.mock("@/core/protocol", () => ({ requestGraphqlCatalog: H.requestGraphqlCatalog }));

const entry = {
  catalog: {
    ListAddMember: { queryId: "a", features: {} },
    ListRemoveMember: { queryId: "r", features: {} },
    UserByScreenName: { queryId: "u", features: {}, fieldToggles: { withPayments: false } },
  },
  fetchedAt: 123,
};

describe("createChromeCatalogCache", () => {
  it("maps cache operations onto the worker protocol", async () => {
    H.requestGraphqlCatalog.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === "begin") {
        return { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } };
      }
      if (request.operation === "read") return { ok: true, entry };
      return { ok: true, entry };
    });
    const cache = createChromeCatalogCache();
    const token = await cache.begin();

    await expect(cache.read()).resolves.toEqual(entry);
    await expect(cache.write(entry, token)).resolves.toEqual(entry);
    expect(H.requestGraphqlCatalog).toHaveBeenCalledTimes(3);
    expect(H.requestGraphqlCatalog).toHaveBeenLastCalledWith({
      type: "lasso:graphql-catalog",
      operation: "commit",
      token,
      catalog: entry.catalog,
    });
  });

  it("keeps protocol error shapes at the adapter boundary", async () => {
    const cache = createChromeCatalogCache();
    H.requestGraphqlCatalog
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await expect(cache.read()).resolves.toBeNull();
    await expect(cache.begin()).rejects.toThrow("GraphQL cache token unavailable");
    await expect(
      cache.write(entry, { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }),
    ).resolves.toBeUndefined();

    H.requestGraphqlCatalog.mockResolvedValueOnce({ ok: true, entry: null });
    await expect(
      cache.write(entry, { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 }),
    ).resolves.toBeUndefined();
  });
});
