import { describe, expect, it, vi } from "vitest";

import { GraphqlXListApi } from "@/packages/x-client/graphql-api";
import type { GraphqlOperationCatalog } from "@/packages/x-client/graphql-contract";
import type { GraphqlCatalogResolver } from "@/packages/x-client/graphql-ops";
import type { Credentials, GraphqlClientConfig } from "@/packages/x-client/types";

const creds: Credentials = { csrf: "ct0", bearer: "bearer" };
const catalog: GraphqlOperationCatalog = {
  ListAddMember: {
    queryId: "add",
    features: { mutation: true },
    fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
  },
  ListRemoveMember: {
    queryId: "remove",
    features: { mutation: true },
    fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
  },
  UserByScreenName: {
    queryId: "user",
    features: { lookup: true },
    fieldToggles: { withPayments: false },
  },
};
const changed: GraphqlOperationCatalog = {
  ...catalog,
  ListAddMember: { ...catalog.ListAddMember, queryId: "fresh" },
};
const config: GraphqlClientConfig = { baseUrl: "https://x.com/i/api/graphql", catalog };
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const resolver = (current = catalog, refreshed = changed): GraphqlCatalogResolver => ({
  resolve: vi.fn(async () => current),
  refresh: vi.fn(async () => refreshed),
});
const api = (fetch: typeof globalThis.fetch, source = resolver()) =>
  new GraphqlXListApi(() => creds, { fetch, config, catalog: source });
const list = { id: "L", name: "List" };
const author = { screenName: "u", userId: "U" };

describe("GraphqlXListApi", () => {
  it("sends the mutation descriptor, including current field toggles", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => response({ data: { list: {} } }));
    await api(fetch as unknown as typeof globalThis.fetch).addMember(list, author);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/add/ListAddMember");
    expect(JSON.parse(String(init.body))).toEqual({
      variables: { listId: "L", userId: "U" },
      features: { mutation: true },
      fieldToggles: { withAuxiliaryUserLabels: false, withPayments: false },
      queryId: "add",
    });
  });

  it("removes a known user with the remove descriptor", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => response({ data: { list: {} } }));

    await expect(
      api(fetch as unknown as typeof globalThis.fetch).removeMember(list, author),
    ).resolves.toBeUndefined();
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/remove/ListRemoveMember");
  });

  it("refuses malformed query IDs before sending a request", async () => {
    const source = resolver({
      ...catalog,
      ListAddMember: { ...catalog.ListAddMember, queryId: "a/../b" },
    });
    const fetch = vi.fn();
    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown", message: /invalid graphql query id/i });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends nonempty lookup field toggles only when its descriptor has them", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes("UserByScreenName")
        ? response({ data: { user: { result: { rest_id: "U" } } } })
        : response({ data: { list: {} } }),
    );
    await api(fetch as unknown as typeof globalThis.fetch).addMember(list, { screenName: "u" });
    const lookup = new URL(fetch.mock.calls[0]![0]);
    expect(JSON.parse(lookup.searchParams.get("fieldToggles") ?? "{}")).toEqual({
      withPayments: false,
    });
  });

  it.each([
    ["404", () => response({}, 404)],
    [
      "required feature 400",
      () => response({ errors: [{ message: "features cannot be null: mutation" }] }, 400),
    ],
    [
      "missing field toggle 400",
      () => response({ errors: [{ message: "missing fieldToggles: withPayments" }] }, 400),
    ],
  ])("refreshes once and retries changed catalogs after %s", async (_label, make) => {
    const source = resolver();
    const fetch = vi.fn(async (url: string) =>
      url.includes("/add/") ? make() : response({ data: { list: {} } }),
    );
    await api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author);
    expect(source.refresh).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://x.com/i/api/graphql/add/ListAddMember",
      "https://x.com/i/api/graphql/fresh/ListAddMember",
    ]);
  });

  it("fails plainly without retry when refresh returns the same catalog", async () => {
    const source = resolver(catalog, catalog);
    const fetch = vi.fn(async () => response({}, 404));
    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown", message: /catalog is stale/ });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fails plainly when the one allowed retry also finds a stale endpoint", async () => {
    const source = resolver();
    const fetch = vi.fn(async () => response({}, 404));

    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown", message: /after one compatible refresh/i });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["generic 400", response({}, 400)],
    ["auth", response({}, 401)],
    ["rate limit", response({}, 429)],
    ["malformed success", new Response("nope", { status: 200 })],
    ["business response", response({ errors: [{ message: "User is already a member" }] })],
  ])("never refreshes %s", async (_label, result) => {
    const source = resolver();
    const fetch = vi.fn(async () => result.clone());
    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toBeTruthy();
    expect(source.refresh).not.toHaveBeenCalled();
  });

  it.each([
    response({}),
    response({ data: {} }),
    response({ data: { list: null } }),
    response({ data: { list: {} }, errors: { message: "business failure" } }),
  ])("rejects malformed or error-bearing mutation success", async (result) => {
    const fetch = vi.fn(async () => result.clone());
    await expect(
      api(fetch as unknown as typeof globalThis.fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("accepts valid mutation data beside field-level GraphQL errors", async () => {
    const fetch = vi.fn(async () =>
      response({
        data: { list: {} },
        errors: [{ message: "com.twitter.strato.serialization.DecodeException" }],
      }),
    );

    await expect(
      api(fetch as unknown as typeof globalThis.fetch).addMember(list, author),
    ).resolves.toBeUndefined();
  });

  it("does not treat malformed GraphQL error entries as a catalog gateway", async () => {
    const source = resolver();
    const fetch = vi.fn(async () => response({ errors: [null, { message: 1 }] }, 400));

    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toBeTruthy();
    expect(source.refresh).not.toHaveBeenCalled();
  });

  it("handles an unparseable 400 body without treating it as catalog drift", async () => {
    const source = resolver();
    const fetch = vi.fn(async () => new Response("nope", { status: 400 }));
    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toBeTruthy();
    expect(source.refresh).not.toHaveBeenCalled();
  });

  it("keeps the retry's real failure instead of masking it as catalog drift", async () => {
    const source = resolver();
    const fetch = vi.fn(async (url: string) =>
      url.includes("/fresh/") ? response({}, 401) : response({}, 404),
    );

    await expect(
      api(fetch as unknown as typeof globalThis.fetch, source).addMember(list, author),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects unresolved authors and omits empty optional GraphQL metadata", async () => {
    const noOptionalMetadata = {
      ...catalog,
      ListAddMember: { queryId: "add", features: { mutation: true } },
      UserByScreenName: { queryId: "user", features: { lookup: true } },
    } satisfies GraphqlOperationCatalog;
    const missing = vi.fn(async (_input: RequestInfo | URL) =>
      response({ data: { user: { result: {} } } }),
    );
    await expect(
      api(missing as unknown as typeof globalThis.fetch, resolver(noOptionalMetadata)).addMember(
        list,
        {
          screenName: "missing",
        },
      ),
    ).rejects.toMatchObject({ kind: "not-found" });
    expect(new URL(String(missing.mock.calls[0]?.[0])).searchParams.has("fieldToggles")).toBe(
      false,
    );

    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response({ data: { list: {} } }),
    );
    await api(fetch as unknown as typeof globalThis.fetch, resolver(noOptionalMetadata)).addMember(
      list,
      author,
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty("fieldToggles");

    const same = resolver(noOptionalMetadata, noOptionalMetadata);
    const stale = vi.fn(async () => response({}, 404));
    await expect(
      api(stale as unknown as typeof globalThis.fetch, same).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown" });
  });
});
