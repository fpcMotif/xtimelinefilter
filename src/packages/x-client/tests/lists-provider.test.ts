import { describe, expect, it, vi } from "vitest";

import { fetchMembershipListIds, fetchOwnedLists } from "@/packages/x-client/lists-provider";

const creds = { csrf: "ct0", bearer: "B" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchOwnedLists", () => {
  it("gets the first ownership page with auth headers and maps it to XList[]", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [
          { id_str: "1", name: "Research", member_count: 12 },
          { id_str: "2", name: "Friends" },
        ],
        next_cursor_str: "0",
      }),
    );
    const lists = await fetchOwnedLists({
      fetch: fetchMock as unknown as typeof fetch,
      creds,
    });

    expect(lists).toEqual([
      { id: "1", name: "Research", memberCount: 12 },
      { id: "2", name: "Friends" },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe("/i/api/1.1/lists/ownerships.json");
    expect(params.get("count")).toBe("1000");
    expect(params.get("cursor")).toBe("-1");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("ct0");
    expect(init.credentials).toBe("include");
  });

  it("reads every ownership page and keeps the first copy of each List", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      if (cursor === "-1") {
        return jsonResponse({
          lists: [
            { id_str: "1", name: "First" },
            { id_str: "2", name: "Two" },
          ],
          next_cursor_str: "44",
        });
      }
      return jsonResponse({
        lists: [
          { id_str: "2", name: "Later duplicate" },
          { id_str: "3", name: "Three" },
        ],
        next_cursor: 0,
      });
    });

    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).resolves.toEqual([
      { id: "1", name: "First" },
      { id: "2", name: "Two" },
      { id: "3", name: "Three" },
    ]);
    expect(
      fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get("cursor")),
    ).toEqual(["-1", "44"]);
  });

  it("uses next_cursor_str when next_cursor cannot represent the cursor exactly", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      if (cursor === "-1") {
        return jsonResponse({
          lists: [{ id_str: "1", name: "One" }],
          next_cursor_str: "9007199254740993",
          next_cursor: Number.MAX_SAFE_INTEGER + 2,
        });
      }
      return jsonResponse({ lists: [{ id_str: "2", name: "Two" }], next_cursor: 0 });
    });

    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).resolves.toEqual([
      { id: "1", name: "One" },
      { id: "2", name: "Two" },
    ]);
    expect(new URL(fetchMock.mock.calls[1]?.[0] as string).searchParams.get("cursor")).toBe(
      "9007199254740993",
    );
  });

  it("rejects malformed required List rows", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [{ id_str: "1", name: "Ok" }, { name: "No id" }],
        next_cursor: 0,
      }),
    );
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("rejects non-object List rows before accepting a catalog", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [null], next_cursor: 0 }));

    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("omits invalid optional fields without rejecting valid List rows", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        lists: [
          { id_str: "3", name: "Unknown optional fields", member_count: -1, mode: "circle" },
          { id_str: "4", name: "Valid", member_count: 0, mode: "public" },
        ],
        next_cursor_str: "0",
      }),
    );

    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).resolves.toEqual([
      { id: "3", name: "Unknown optional fields" },
      { id: "4", name: "Valid", memberCount: 0, isPrivate: false },
    ]);
  });

  it("requires a terminal cursor before it accepts a catalog", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [] }));
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("rejects repeated and invalid cursors", async () => {
    for (const next_cursor_str of ["-1", "01"]) {
      const fetchMock = vi.fn(async () => jsonResponse({ lists: [], next_cursor_str }));
      await expect(
        fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
      ).rejects.toMatchObject({ kind: "unknown" });
    }
  });

  it("does not return a partial catalog when a later page fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ lists: [{ id_str: "1", name: "One" }], next_cursor: 7 }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "unknown" });
  });

  it("rejects malformed catalog envelopes instead of claiming there are no Lists", async () => {
    for (const body of [{}, { lists: {} }]) {
      const fetchMock = vi.fn(async () => jsonResponse(body));
      await expect(
        fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
      ).rejects.toMatchObject({ kind: "unknown" });
    }
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

describe("fetchOwnedLists — ensureOk adoption", () => {
  it("throws rate-limited for a 200 response carrying errors:[{code:88}]", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 88, message: "Rate limit exceeded" }] }, 200),
    );
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "rate-limited" });
  });

  it("classifies non-429/401/403 statuses through REST_PROFILE body errors", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ errors: [{ code: 32, message: "Could not authenticate you" }] }, 400),
    );
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
        next_cursor: 0,
      }),
    );
    const lists = await fetchOwnedLists({
      fetch: fetchMock as unknown as typeof fetch,
      creds,
    });
    expect(lists.map((list) => list.isPrivate)).toEqual([false, true]);
  });

  it("carries the rate-limit reset on 429 so the picker can name a wait time", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 429,
          headers: { "x-rate-limit-reset": "1750000123" },
        }),
    );
    await expect(
      fetchOwnedLists({ fetch: fetchMock as unknown as typeof fetch, creds }),
    ).rejects.toMatchObject({ kind: "rate-limited", resetAt: 1750000123 });
  });
});

describe("fetchMembershipListIds — the picker's already-in checks", () => {
  it("reads every owned-membership page, dedupes ids, and returns them", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const cursor = new URL(url).searchParams.get("cursor");
      if (cursor === "-1") {
        return jsonResponse({ lists: [{ id_str: "9" }], next_cursor_str: "12" });
      }
      return jsonResponse({ lists: [{ id_str: "12" }, { id_str: "9" }], next_cursor: 0 });
    });
    const ids = await fetchMembershipListIds(
      { fetch: fetchMock as unknown as typeof fetch, creds },
      "jane",
    );

    expect(ids).toEqual(["9", "12"]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe("/i/api/1.1/lists/memberships.json");
    expect(params.get("screen_name")).toBe("jane");
    expect(params.get("filter_to_owned_lists")).toBe("true");
    expect(params.get("count")).toBe("1000");
    expect(params.get("cursor")).toBe("-1");
  });

  it("returns null on a non-OK response or later-page failure", async () => {
    const failed = vi.fn(async () => jsonResponse({}, 500));
    await expect(
      fetchMembershipListIds({ fetch: failed as unknown as typeof fetch, creds }, "jane"),
    ).resolves.toBeNull();

    const laterFailure = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ lists: [{ id_str: "1" }], next_cursor: 7 }))
      .mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(
      fetchMembershipListIds({ fetch: laterFailure as unknown as typeof fetch, creds }, "jane"),
    ).resolves.toBeNull();
  });

  it("returns null for incomplete, repeated, or malformed membership pages", async () => {
    for (const body of [
      {},
      { lists: [] },
      { lists: [], next_cursor_str: "-1" },
      { lists: [], next_cursor_str: "not-a-cursor" },
      { lists: [{ id_str: 9 }], next_cursor: 0 },
      { lists: [{ name: "No id" }], next_cursor: 0 },
    ]) {
      const fetchMock = vi.fn(async () => jsonResponse(body));
      await expect(
        fetchMembershipListIds({ fetch: fetchMock as unknown as typeof fetch, creds }, "jane"),
      ).resolves.toBeNull();
    }
  });

  it("accepts a numeric id only when id_str is absent", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ lists: [{ id: 42 }], next_cursor_str: "0" }),
    );
    await expect(
      fetchMembershipListIds({ fetch: fetchMock as unknown as typeof fetch, creds }, "jane"),
    ).resolves.toEqual(["42"]);
  });

  it("returns [] only for an explicit terminal empty page", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ lists: [], next_cursor: 0 }));
    await expect(
      fetchMembershipListIds({ fetch: fetchMock as unknown as typeof fetch, creds }, "jane"),
    ).resolves.toEqual([]);
  });

  it("returns null when the fetch itself throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    await expect(
      fetchMembershipListIds({ fetch: fetchMock as unknown as typeof fetch, creds }, "jane"),
    ).resolves.toBeNull();
  });
});
