import { describe, expect, it, vi } from "vitest";

import { DomXListApi } from "@/packages/x-client/dom-api";
import type { PageDriver } from "@/packages/x-client/dom-page-driver";
import { createXListApi } from "@/packages/x-client/factory";
import { GraphqlXListApi } from "@/packages/x-client/graphql-api";
import { RestXListApi } from "@/packages/x-client/rest-api";

const fakeDriver: PageDriver = {
  openListsDialog: async () => {},
  isChecked: async () => false,
  toggleList: async () => {},
  commit: async () => {},
  close: async () => {},
};
function runtime() {
  const credentials = vi.fn(() => ({ csrf: "c", bearer: "b" }));
  const createPageDriver = vi.fn(() => fakeDriver);
  const fetch = vi.fn(
    async () => new Response("", { status: 200 }),
  ) as unknown as typeof globalThis.fetch;
  return { fetch, credentials, createPageDriver };
}

describe("createXListApi", () => {
  it("builds REST by default and keeps credentials lazy", async () => {
    const deps = runtime();
    const api = createXListApi("rest", deps);

    expect(api).toBeInstanceOf(RestXListApi);
    expect(deps.credentials).not.toHaveBeenCalled();
    expect(deps.createPageDriver).not.toHaveBeenCalled();

    await api.addMember({ id: "1", name: "Research" }, { screenName: "jack" });
    expect(deps.credentials).toHaveBeenCalledTimes(1);
  });

  it("creates a PageDriver only for DOM", () => {
    const deps = runtime();
    const api = createXListApi("dom", deps);

    expect(api).toBeInstanceOf(DomXListApi);
    expect(deps.createPageDriver).toHaveBeenCalledTimes(1);
    expect(deps.credentials).not.toHaveBeenCalled();
  });

  it("keeps credentials lazy for GraphQL", async () => {
    const deps = runtime();
    const api = createXListApi("graphql", deps);

    expect(api).toBeInstanceOf(GraphqlXListApi);
    expect(deps.credentials).not.toHaveBeenCalled();
    expect(deps.createPageDriver).not.toHaveBeenCalled();

    await api.addMember({ id: "1", name: "Research" }, { screenName: "jack", userId: "2" });
    expect(deps.credentials).toHaveBeenCalledTimes(1);
  });

  it("falls back to REST for an unknown strategy", () => {
    const deps = runtime();
    expect(createXListApi("other" as never, deps)).toBeInstanceOf(RestXListApi);
  });

  it("uses the provided GraphQL ops resolver", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const deps = { ...runtime(), fetch: fetchMock as unknown as typeof globalThis.fetch };
    const live = {
      ListAddMember: "liveAdd",
      ListRemoveMember: "liveRm",
      UserByScreenName: "liveUser",
    };
    const graphqlOps = { resolve: vi.fn(async () => live), refresh: vi.fn(async () => live) };
    const api = createXListApi("graphql", { ...deps, graphqlOps });

    await api.addMember({ id: "1", name: "Research" }, { screenName: "jack", userId: "2" });

    expect(graphqlOps.resolve).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://x.com/i/api/graphql/liveAdd/ListAddMember");
  });

  it("defaults to a scraping resolver seeded with the static fallback ids", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response("", { status: 200 })); // empty body → scrape finds nothing
    const deps = { ...runtime(), fetch: fetchMock as unknown as typeof globalThis.fetch };
    const api = createXListApi("graphql", deps);

    await api.addMember({ id: "1", name: "Research" }, { screenName: "jack", userId: "2" });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toBe("https://x.com/"); // scrape attempt…
    expect(urls.at(-1)).toContain("yhAkn9q5qaSCxPg_fpykDw/ListAddMember"); // …then static seed
  });
});
