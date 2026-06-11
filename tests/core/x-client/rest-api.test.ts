import { describe, expect, it, vi } from "vitest";

import { addToList, blockUser, muteUser, RestXListApi, unmuteUser } from "@/core/x-client/rest-api";
import type { Credentials, XList } from "@/core/x-client/types";

const creds: Credentials = { csrf: "ct0", bearer: "BEARER" };
const ok = () => new Response(JSON.stringify({}), { status: 200 });

function parseBody(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(init.body as string));
}

describe("v1.1 REST writes", () => {
  it("addToList POSTs lists/members/create.json with list_id + screen_name and auth headers", async () => {
    const fetchMock = vi.fn(async () => ok());
    await addToList({ fetch: fetchMock as unknown as typeof fetch, creds }, "L1", "jack");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.com/i/api/1.1/lists/members/create.json");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("ct0");
    expect(parseBody(init)).toEqual({ list_id: "L1", screen_name: "jack" });
  });

  it("muteUser and blockUser hit the right endpoints by screen_name", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok());
    const deps = { fetch: fetchMock as unknown as typeof fetch, creds };
    await muteUser(deps, "jack");
    await blockUser(deps, "jack");
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "https://x.com/i/api/1.1/mutes/users/create.json",
      "https://x.com/i/api/1.1/blocks/create.json",
    ]);
  });

  it("maps HTTP 429 to rate-limited and 403 to auth", async () => {
    const rl = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(
      muteUser({ fetch: rl as unknown as typeof fetch, creds }, "x"),
    ).rejects.toMatchObject({
      kind: "rate-limited",
    });
    const auth = vi.fn(async () => new Response("{}", { status: 403 }));
    await expect(
      muteUser({ fetch: auth as unknown as typeof fetch, creds }, "x"),
    ).rejects.toMatchObject({ kind: "auth" });
  });

  it("RestXListApi.addMember adds by screen_name (no id resolution)", async () => {
    const fetchMock = vi.fn(async () => ok());
    const api = new RestXListApi(fetchMock as unknown as typeof fetch, () => creds);
    const list: XList = { id: "L9", name: "Research" };
    await api.addMember(list, { screenName: "alice" });
    expect(await api.resolveUserId("alice")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("lists/members/create.json");
    expect(parseBody(init)).toEqual({ list_id: "L9", screen_name: "alice" });
  });
});

describe("story beats 6 & 8 — typed failure detail", () => {
  it("carries x-rate-limit-reset on HTTP 429 so the toast can say 'try again in N min'", async () => {
    const rl = vi.fn(
      async () =>
        new Response("{}", { status: 429, headers: { "x-rate-limit-reset": "1750000000" } }),
    );
    await expect(
      addToList({ fetch: rl as unknown as typeof fetch, creds }, "L1", "jack"),
    ).rejects.toMatchObject({ kind: "rate-limited", resetAt: 1750000000 });
  });

  it("maps protected-account refusals (code 104) to the protected outcome", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 104, message: "You aren't allowed to add this member to this list." }],
          }),
          { status: 200 },
        ),
    );
    await expect(
      addToList({ fetch: fetchMock as unknown as typeof fetch, creds }, "L1", "jack"),
    ).rejects.toMatchObject({ kind: "protected" });
  });

  it("unmuteUser hits mutes/users/destroy.json (the Undo verb for Muted @jane)", async () => {
    const fetchMock = vi.fn(async () => ok());
    await unmuteUser({ fetch: fetchMock as unknown as typeof fetch, creds }, "jane");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.com/i/api/1.1/mutes/users/destroy.json");
    expect(parseBody(init)).toEqual({ screen_name: "jane" });
  });
});
