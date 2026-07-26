import { describe, expect, it, vi } from "vitest";

import type { CacheObservation } from "@/core/cache-observation";
import type { LassoSettings, SettingsStore } from "@/core/settings";
import { GraphqlXListApi } from "@/packages/x-client/graphql-api";
import type { GraphqlCatalogCache } from "@/packages/x-client/graphql-ops";
import { RestXListApi } from "@/packages/x-client/rest-api";
import { createXPageClient } from "@/packages/x-client/x-page-client";

const token: CacheObservation = {
  epoch: "00000000-0000-4000-8000-000000000001",
  sequence: 1,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function settings() {
  const listeners = new Set<(next: LassoSettings) => void>();
  const unsubscribe = vi.fn();
  return {
    emit(next: Partial<LassoSettings>) {
      for (const listener of listeners) listener(next as LassoSettings);
    },
    unsubscribe,
    store: {
      subscribe(listener: (next: LassoSettings) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
    } satisfies Pick<SettingsStore, "subscribe">,
  };
}

function cache(): GraphqlCatalogCache {
  return {
    read: vi.fn(async () => null),
    begin: vi.fn(async () => token),
    write: vi.fn(async () => undefined),
  };
}

describe("createXPageClient", () => {
  it("keeps all page X reads and quick actions behind one credential source", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const path = new URL(url).pathname;
      if (path.endsWith("/ownerships.json")) {
        return jsonResponse({
          lists: [{ id_str: "1", name: "Research" }],
          next_cursor: 0,
        });
      }
      if (path.endsWith("/memberships.json")) {
        return jsonResponse({ lists: [{ id_str: "1" }], next_cursor: 0 });
      }
      return new Response("", { status: 200 });
    });
    const page = createXPageClient({
      initialBackend: "rest",
      settings: settings().store,
      graphqlCache: cache(),
      getCookie: () => "ct0=csrf",
      fetch: fetchMock as unknown as typeof fetch,
      document,
      findAuthorCaret: () => null,
      dispatchSyntheticEscape: () => {},
    });

    await expect(page.ownedLists()).resolves.toEqual([{ id: "1", name: "Research" }]);
    await expect(page.membershipListIds("alice")).resolves.toEqual(["1"]);
    await page.mute("alice");
    await page.unmute("alice");
    await page.block("alice");

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/i/api/1.1/lists/ownerships.json",
      "/i/api/1.1/lists/memberships.json",
      "/i/api/1.1/mutes/users/create.json",
      "/i/api/1.1/mutes/users/destroy.json",
      "/i/api/1.1/blocks/create.json",
    ]);
    for (const { init } of requests) {
      expect(init).toBeDefined();
      expect(init!.credentials).toBe("include");
      expect((init!.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf");
    }
  });

  it("uses page defaults and creates the DOM driver only for the DOM backend", async () => {
    document.cookie = "ct0=csrf; path=/";
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    const page = createXPageClient({
      initialBackend: "dom",
      settings: settings().store,
      graphqlCache: cache(),
      findAuthorCaret: () => null,
      dispatchSyntheticEscape: () => {},
    });

    await expect(
      page.lists
        .snapshot()
        .addMember({ id: "1", name: "Research" }, { screenName: "alice", userId: "2" }),
    ).rejects.toThrow("no visible tweet");
    await page.mute("alice");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://x.com/i/api/1.1/mutes/users/create.json",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
    page.dispose();
    document.cookie = "ct0=; Max-Age=0; path=/";
  });

  it("owns settings-driven adapter replacement and stops it on dispose", () => {
    const s = settings();
    const page = createXPageClient({
      initialBackend: "rest",
      settings: s.store,
      graphqlCache: cache(),
      getCookie: () => "ct0=csrf",
      fetch: vi.fn() as unknown as typeof fetch,
      findAuthorCaret: () => null,
      dispatchSyntheticEscape: () => {},
    });

    const rest = page.lists.snapshot();
    expect(rest).toBeInstanceOf(RestXListApi);
    s.emit({ backend: "graphql" });
    expect(page.lists.snapshot()).toBeInstanceOf(GraphqlXListApi);

    page.dispose();
    page.dispose();
    s.emit({ backend: "rest" });
    expect(page.lists.snapshot()).toBeInstanceOf(GraphqlXListApi);
    expect(s.unsubscribe).toHaveBeenCalledOnce();
  });

  it("uses the supplied worker cache only for GraphQL work", async () => {
    const graphCache = cache();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://x.com/") return new Response("");
      return jsonResponse({ data: { list: {} } });
    });
    const page = createXPageClient({
      initialBackend: "graphql",
      settings: settings().store,
      graphqlCache: graphCache,
      getCookie: () => "ct0=csrf",
      fetch: fetchMock as unknown as typeof fetch,
      findAuthorCaret: () => null,
      dispatchSyntheticEscape: () => {},
    });

    await page.lists
      .snapshot()
      .addMember({ id: "1", name: "Research" }, { screenName: "alice", userId: "2" });

    expect(graphCache.read).toHaveBeenCalledOnce();
    expect(graphCache.begin).toHaveBeenCalledOnce();
    expect(new URL(fetchMock.mock.calls.at(-1)?.[0] as string).pathname).toContain(
      "/i/api/graphql/",
    );
  });
});
