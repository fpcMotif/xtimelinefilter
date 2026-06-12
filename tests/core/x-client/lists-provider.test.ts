import { describe, expect, it, vi } from "vitest";

import { fetchOwnedLists } from "@/core/x-client/lists-provider";

const creds = { csrf: "ct0", bearer: "B" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchOwnedLists", () => {
  it("GETs the v1.1 ownerships endpoint with auth headers and maps to XList[]", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [
          { id_str: "1", name: "Research", member_count: 12 },
          { id_str: "2", name: "Friends" },
        ],
      }),
    );
    const lists = await fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds });

    expect(lists).toEqual([
      { id: "1", name: "Research", memberCount: 12 },
      { id: "2", name: "Friends", memberCount: undefined },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/i/api/1.1/lists/ownerships.json");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("ct0");
    expect(init.credentials).toBe("include");
  });

  it("drops malformed list entries", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [
          { id_str: "1", name: "Ok" },
          { id: 2, name: "Numeric id" },
          { name: "No id" },
          { id_str: "3" },
        ],
      }),
    );
    const lists = await fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds });
    expect(lists).toEqual([
      { id: "1", name: "Ok", memberCount: undefined },
      { id: "2", name: "Numeric id", memberCount: undefined },
    ]);
  });

  it("returns an empty list when the payload omits lists", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).resolves.toEqual([]);
  });

  it("maps rate limits and other HTTP failures to typed errors", async () => {
    const rateLimited = vi.fn(async () => jsonResponse({}, 429));
    await expect(
      fetchOwnedLists({ fetch: rateLimited as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "rate-limited" });

    const unknown = vi.fn(async () => jsonResponse({}, 500));
    await expect(
      fetchOwnedLists({ fetch: unknown as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("maps auth failures to a typed error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});
