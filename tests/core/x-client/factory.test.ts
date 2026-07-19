import { describe, expect, it, vi } from "vitest";

import { DomXListApi } from "@/core/x-client/dom-api";
import { createXListApi } from "@/core/x-client/factory";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import type { PageDriver } from "@/core/x-client/page-driver";
import { RestXListApi } from "@/core/x-client/rest-api";

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
});
