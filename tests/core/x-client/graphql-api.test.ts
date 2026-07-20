import { describe, expect, it, vi } from "vitest";

import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import type { GraphqlOpsResolver } from "@/core/x-client/graphql-ops";
import type { Credentials, GraphqlConfig, GraphqlOps } from "@/core/x-client/types";
import { XApiError } from "@/core/x-client/types";

const creds: Credentials = { csrf: "ct0token", bearer: "BEARER123" };
const list = { id: "L1", name: "Research" };
const author = { screenName: "u", userId: "U9" };

const config: GraphqlConfig = {
  baseUrl: "https://x.com/i/api/graphql",
  ops: {
    ListAddMember: "addQID",
    ListRemoveMember: "removeQID",
    UserByScreenName: "userQID",
  },
  features: { responsive_web_graphql_timeline_navigation_enabled: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const opsStub = (overrides: Partial<GraphqlOpsResolver> = {}): GraphqlOpsResolver => ({
  resolve: async () => config.ops,
  refresh: async () => config.ops,
  ...overrides,
});

function makeApi(
  fetchImpl: typeof fetch,
  getCredentials = () => creds,
  ops: GraphqlOpsResolver = opsStub(),
) {
  return new GraphqlXListApi(getCredentials, { fetch: fetchImpl, config, ops });
}

describe("GraphqlXListApi.addMember", () => {
  it("POSTs to the ListAddMember endpoint with auth headers and the right body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { list: { id: "L1" } } }));
    await makeApi(fetchMock as unknown as typeof fetch).addMember(list, author);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // queryId lives in the URL path (verified correction), not the body.
    expect(url).toBe("https://x.com/i/api/graphql/addQID/ListAddMember");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer BEARER123");
    expect(headers["x-csrf-token"]).toBe("ct0token");
    expect(headers["content-type"]).toBe("application/json");
    // listId/userId serialized as strings inside variables.
    const body = JSON.parse(init.body as string);
    expect(body.variables).toEqual({ listId: "L1", userId: "U9" });
    expect(typeof body.variables.listId).toBe("string");
  });

  it("reads rotated credentials for each request", async () => {
    let current: Credentials = { csrf: "first-csrf", bearer: "FIRST" };
    const getCredentials = vi.fn(() => current);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ data: { list: {} } }),
    );
    const api = makeApi(fetchMock as unknown as typeof fetch, getCredentials);

    await api.addMember(list, author);
    current = { csrf: "second-csrf", bearer: "SECOND" };
    await api.removeMember(list, author);

    expect(getCredentials).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(firstInit?.headers).toMatchObject({
      authorization: "Bearer FIRST",
      "x-csrf-token": "first-csrf",
    });
    expect(secondInit?.headers).toMatchObject({
      authorization: "Bearer SECOND",
      "x-csrf-token": "second-csrf",
    });
  });

  it("classifies an 'already a member' error as already-member", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ message: "User is already a member of this List." }] }),
    );
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toThrow(XApiError);
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "already-member" });
  });

  it("maps HTTP 429 to a rate-limited error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 429));
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "rate-limited" });
  });

  // 2026-06-21: reconciled with REST — GraphQL now carries x-rate-limit-reset so the
  // toast can say "try again in N min" (previously dropped; see x-http.ts GRAPHQL_PROFILE).
  it("carries x-rate-limit-reset on HTTP 429", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "x-rate-limit-reset": "1750000000" } }),
    );
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "rate-limited", resetAt: 1750000000 });
  });

  it("carries x-rate-limit-reset on error code 88", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ code: 88, message: "slow down" }] }), {
          status: 200,
          headers: { "x-rate-limit-reset": "1750000456" },
        }),
    );
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "rate-limited", resetAt: 1750000456 });
  });

  it("maps HTTP auth, non-ok, and malformed-json responses", async () => {
    const auth = vi.fn(async () => jsonResponse({}, 401));
    await expect(
      makeApi(auth as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "auth" });

    const unknown = vi.fn(async () => new Response("not json", { status: 500 }));
    await expect(
      makeApi(unknown as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({ kind: "unknown", message: "HTTP 500" });
  });

  it("reports a rotated static query ID as a typed visible failure", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
    ).rejects.toMatchObject({
      kind: "not-found",
      message: "GraphQL ListAddMember endpoint was not found; its query ID may have rotated.",
    });
  });

  it("classifies GraphQL error codes", async () => {
    const cases = [
      [{ code: 88, message: "slow down" }, "rate-limited"],
      [{ code: 104, message: "protected" }, "protected"],
      [{ code: 353, message: "auth" }, "auth"],
      [{ code: 32, message: "missing" }, "auth"],
      [{ code: 999 }, "unknown"],
      [{ message: "" }, "unknown"],
    ] as const;
    for (const [error, kind] of cases) {
      const fetchMock = vi.fn(async () => jsonResponse({ errors: [error] }));
      await expect(
        makeApi(fetchMock as unknown as typeof fetch).addMember(list, author),
      ).rejects.toMatchObject({ kind });
    }
  });

  it("resolves the userId via UserByScreenName when the author has none", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("UserByScreenName")) {
        return jsonResponse({ data: { user: { result: { rest_id: "777" } } } });
      }
      return jsonResponse({ data: { list: {} } });
    });
    await makeApi(fetchMock as unknown as typeof fetch).addMember(list, { screenName: "jack" });
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(lookupInit.method).toBe("GET");
    const lookup = new URL(lookupUrl);
    expect(lookup.pathname).toBe("/i/api/graphql/userQID/UserByScreenName");
    expect(JSON.parse(lookup.searchParams.get("variables") ?? "{}")).toMatchObject({
      screen_name: "jack",
    });
    const post = fetchMock.mock.calls.find((c) => (c[0] as string).includes("ListAddMember"));
    const body = JSON.parse((post?.[1]?.body as string) ?? "{}");
    expect(body.variables).toEqual({ listId: "L1", userId: "777" });
  });

  it("throws not-found when lookup has no rest_id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { user: {} } }));
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, { screenName: "ghost" }),
    ).rejects.toMatchObject({ kind: "not-found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws not-found when lookup returns a non-string rest_id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { user: { result: { rest_id: 777 } } } }),
    );
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, { screenName: "ghost" }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("GraphqlXListApi.removeMember", () => {
  it("POSTs to ListRemoveMember with the queryId in the path and string ids", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { list: {} } }));
    await makeApi(fetchMock as unknown as typeof fetch).removeMember(list, author);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.com/i/api/graphql/removeQID/ListRemoveMember");
    expect(JSON.parse(init.body as string).variables).toEqual({ listId: "L1", userId: "U9" });
  });
});

// Query ids rotate with X deploys (2026-07-19: all three rotated at once and adds
// silently failed). The backend self-heals: endpoint 404 → one resolver refresh → one retry.
describe("GraphqlXListApi query-id rotation recovery", () => {
  const refreshedOps: GraphqlOps = {
    ListAddMember: "freshAddQID",
    ListRemoveMember: "freshRemoveQID",
    UserByScreenName: "freshUserQID",
  };

  it("refreshes once on a 404 and retries the mutation with fresh ids", async () => {
    const refresh = vi.fn(async () => refreshedOps);
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("addQID") ? jsonResponse({}, 404) : jsonResponse({ data: { list: {} } }),
    );

    await makeApi(
      fetchMock as unknown as typeof fetch,
      () => creds,
      opsStub({ refresh }),
    ).addMember(list, author);

    expect(refresh).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      "https://x.com/i/api/graphql/addQID/ListAddMember",
      "https://x.com/i/api/graphql/freshAddQID/ListAddMember",
    ]);
  });

  it("surfaces the typed rotated failure when the retry also 404s", async () => {
    const refresh = vi.fn(async () => refreshedOps);
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));

    await expect(
      makeApi(fetchMock as unknown as typeof fetch, () => creds, opsStub({ refresh })).addMember(
        list,
        author,
      ),
    ).rejects.toMatchObject({
      kind: "not-found",
      message: "GraphQL ListAddMember endpoint was not found; its query ID may have rotated.",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes and retries a rotated UserByScreenName lookup endpoint", async () => {
    // Model the real resolver: a refresh updates what later resolves return.
    let current = config.ops;
    const resolve = vi.fn(async () => current);
    const refresh = vi.fn(async () => (current = refreshedOps));
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("userQID")) return jsonResponse({}, 404);
      if (u.includes("UserByScreenName")) {
        return jsonResponse({ data: { user: { result: { rest_id: "777" } } } });
      }
      return jsonResponse({ data: { list: {} } });
    });

    await makeApi(
      fetchMock as unknown as typeof fetch,
      () => creds,
      opsStub({ resolve, refresh }),
    ).addMember(list, { screenName: "jack" });

    expect(refresh).toHaveBeenCalledTimes(1);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/userQID/UserByScreenName");
    expect(urls[1]).toContain("/freshUserQID/UserByScreenName");
    expect(urls[2]).toContain("/freshAddQID/ListAddMember");
  });

  it("does not refresh when the lookup returns no user (not a rotation)", async () => {
    const refresh = vi.fn(async () => refreshedOps);
    const fetchMock = vi.fn(async () => jsonResponse({ data: { user: {} } }));

    await expect(
      makeApi(fetchMock as unknown as typeof fetch, () => creds, opsStub({ refresh })).addMember(
        list,
        { screenName: "ghost" },
      ),
    ).rejects.toMatchObject({ kind: "not-found", message: "Could not resolve @ghost" });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on non-404 failures like rate limiting", async () => {
    const refresh = vi.fn(async () => refreshedOps);
    const fetchMock = vi.fn(async () => jsonResponse({}, 429));

    await expect(
      makeApi(fetchMock as unknown as typeof fetch, () => creds, opsStub({ refresh })).addMember(
        list,
        author,
      ),
    ).rejects.toMatchObject({ kind: "rate-limited" });
    expect(refresh).not.toHaveBeenCalled();
  });
});
