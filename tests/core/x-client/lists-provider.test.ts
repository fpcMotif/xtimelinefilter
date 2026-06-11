import { describe, expect, it, vi } from "vitest";

import { fetchMembershipListIds, fetchOwnedLists } from "@/core/x-client/lists-provider";

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
      jsonResponse({ lists: [{ id_str: "1", name: "Ok" }, { name: "No id" }, { id_str: "3" }] }),
    );
    const lists = await fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds });
    expect(lists).toEqual([{ id: "1", name: "Ok", memberCount: undefined }]);
  });

  it("maps auth failures to a typed error", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 401));
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("story beat 4 — picker anatomy data", () => {
  it("marks private Lists so the picker can show lock icons", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [
          { id_str: "1", name: "Public", mode: "public" },
          { id_str: "2", name: "Secret", mode: "private" },
        ],
      }),
    );
    const lists = await fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds });
    expect(lists.map((l) => l.isPrivate)).toEqual([false, true]);
  });

  it("carries the rate-limit reset on 429 so the picker can name a wait time", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "x-rate-limit-reset": "1750000123" } }),
    );
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "rate-limited", resetAt: 1750000123 });
  });
});

describe("fetchMembershipListIds — the picker's 'already in' blue checks", () => {
  it("GETs lists/memberships.json filtered to owned lists and returns the ids", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ lists: [{ id_str: "9", name: "Design Folks" }, { id_str: "12" }] }),
    );
    const ids = await fetchMembershipListIds(
      { fetch: fetchMock as unknown as typeof fetch, creds },
      "jane",
    );
    expect(ids).toEqual(["9", "12"]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/i/api/1.1/lists/memberships.json");
    expect(url).toContain("screen_name=jane");
    expect(url).toContain("filter_to_owned_lists=true");
  });

  it("returns [] on failure — checks are progressive enhancement, never a blocker", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const ids = await fetchMembershipListIds(
      { fetch: fetchMock as unknown as typeof fetch, creds },
      "jane",
    );
    expect(ids).toEqual([]);
  });
});
