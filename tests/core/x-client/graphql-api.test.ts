import { describe, expect, it, vi } from "vitest";

import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import type { Credentials, GraphqlConfig } from "@/core/x-client/types";
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

function makeApi(fetchImpl: typeof fetch) {
  return new GraphqlXListApi(creds, { fetch: fetchImpl, config });
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
    const post = fetchMock.mock.calls.find((c) => (c[0] as string).includes("ListAddMember"));
    const body = JSON.parse((post?.[1]?.body as string) ?? "{}");
    expect(body.variables).toEqual({ listId: "L1", userId: "777" });
  });

  it("throws not-found when a userId cannot be resolved", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { user: {} } }));
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).addMember(list, { screenName: "ghost" }),
    ).rejects.toMatchObject({ kind: "not-found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe("GraphqlXListApi.resolveUserId", () => {
  it("GETs UserByScreenName and returns the rest_id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { user: { result: { rest_id: "777" } } } }),
    );
    const id = await makeApi(fetchMock as unknown as typeof fetch).resolveUserId("jack");

    expect(id).toBe("777");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://x.com/i/api/graphql/userQID/UserByScreenName?")).toBe(true);
    expect(init.method).toBe("GET");
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('"screen_name":"jack"');
  });

  it("returns null when the user cannot be found", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { user: {} } }));
    const id = await makeApi(fetchMock as unknown as typeof fetch).resolveUserId("ghost");
    expect(id).toBeNull();
  });

  it("returns null when rest_id is not a string", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { user: { result: { rest_id: 777 } } } }),
    );
    await expect(
      makeApi(fetchMock as unknown as typeof fetch).resolveUserId("ghost"),
    ).resolves.toBeNull();
  });
});

describe("GraphqlXListApi.getLists", () => {
  it("throws the explicit not-implemented error", async () => {
    await expect(makeApi(vi.fn() as unknown as typeof fetch).getLists()).rejects.toMatchObject({
      kind: "unknown",
      message: "GraphqlXListApi.getLists not implemented yet",
    });
  });
});
