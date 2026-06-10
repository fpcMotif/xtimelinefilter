import { describe, expect, it, vi } from "vitest";

import { addToList, blockUser, muteUser, RestXListApi } from "@/core/x-client/rest-api";
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
