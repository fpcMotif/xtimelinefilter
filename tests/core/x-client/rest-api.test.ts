import { describe, expect, it, vi } from "vitest";

import {
  addToList,
  blockUser,
  muteUser,
  removeFromList,
  RestXListApi,
} from "@/core/x-client/rest-api";
import type { Credentials, XList } from "@/core/x-client/types";
import { XApiError } from "@/core/x-client/types";

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

  it("removeFromList POSTs the destroy endpoint", async () => {
    const fetchMock = vi.fn(async () => ok());
    await removeFromList({ fetch: fetchMock as unknown as typeof fetch, creds }, "L1", "jack");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.com/i/api/1.1/lists/members/destroy.json");
    expect(parseBody(init)).toEqual({ list_id: "L1", screen_name: "jack" });
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

  it("classifies v1.1 error payloads", async () => {
    const already = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: "Already added to List." }] }), {
          status: 200,
        }),
    );
    await expect(
      addToList({ fetch: already as unknown as typeof fetch, creds }, "L1", "jack"),
    ).rejects.toMatchObject({ kind: "already-member" });

    const authCode = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ code: 89, message: "token expired" }] }), {
          status: 200,
        }),
    );
    await expect(
      muteUser({ fetch: authCode as unknown as typeof fetch, creds }, "jack"),
    ).rejects.toMatchObject({ kind: "auth" });

    const unknown = vi.fn(
      async () => new Response(JSON.stringify({ errors: [{}] }), { status: 200 }),
    );
    await expect(
      muteUser({ fetch: unknown as unknown as typeof fetch, creds }, "jack"),
    ).rejects.toMatchObject({ kind: "unknown", message: "v1.1 error" });
  });

  it("handles non-json success bodies and non-ok failures", async () => {
    const textOk = vi.fn(async () => new Response("not json", { status: 200 }));
    await expect(
      muteUser({ fetch: textOk as unknown as typeof fetch, creds }, "jack"),
    ).resolves.toBeUndefined();

    const textFail = vi.fn(async () => new Response("not json", { status: 500 }));
    await expect(
      muteUser({ fetch: textFail as unknown as typeof fetch, creds }, "jack"),
    ).rejects.toMatchObject({ kind: "unknown", message: "HTTP 500" });
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

  it("RestXListApi delegates list loading and removal lazily through credentials", async () => {
    let credentialReads = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("ownerships")) {
        return new Response(JSON.stringify({ lists: [{ id_str: "1", name: "Research" }] }), {
          status: 200,
        });
      }
      return ok();
    });
    const api = new RestXListApi(fetchMock as unknown as typeof fetch, () => {
      credentialReads += 1;
      return creds;
    });
    await expect(api.getLists()).resolves.toEqual([
      { id: "1", name: "Research", memberCount: undefined },
    ]);
    await api.removeMember({ id: "L9", name: "Research" }, { screenName: "alice" });
    expect(credentialReads).toBe(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("lists/members/destroy.json");
  });

  it("surfaces typed errors from REST helpers", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    await expect(
      new RestXListApi(fetchMock as unknown as typeof fetch, () => creds).addMember(
        { id: "L", name: "List" },
        { screenName: "x" },
      ),
    ).rejects.toBeInstanceOf(XApiError);
  });
});
