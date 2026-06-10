import { describe, expect, it, vi } from "vitest";

import { DomXListApi } from "@/core/x-client/dom-api";
import { createXListApi } from "@/core/x-client/factory";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import type { PageDriver } from "@/core/x-client/page-driver";
import { RestXListApi } from "@/core/x-client/rest-api";

const fakeDriver: PageDriver = {
  openListsDialog: async () => {},
  listNames: async () => [],
  isChecked: async () => false,
  toggleList: async () => {},
  commit: async () => {},
  close: async () => {},
};
const restApi = new RestXListApi(
  (async () => new Response("{}")) as unknown as typeof fetch,
  () => ({
    csrf: "c",
    bearer: "b",
  }),
);
const domApi = new DomXListApi(fakeDriver);
const gqlApi = new GraphqlXListApi(
  { csrf: "c", bearer: "b" },
  {
    fetch: (async () => new Response("{}")) as unknown as typeof fetch,
    config: {
      baseUrl: "https://x.com/i/api/graphql",
      ops: { ListAddMember: "a", ListRemoveMember: "r", UserByScreenName: "u" },
      features: {},
    },
  },
);

const builders = { rest: () => restApi, dom: () => domApi, graphql: () => gqlApi };

describe("createXListApi", () => {
  it("returns the REST backend by default", () => {
    expect(createXListApi("rest", builders)).toBe(restApi);
  });

  it("returns the DOM and GraphQL backends when selected", () => {
    expect(createXListApi("dom", builders)).toBe(domApi);
    expect(createXListApi("graphql", builders)).toBe(gqlApi);
  });

  it("builds only the chosen backend", () => {
    const rest = vi.fn(() => restApi);
    const dom = vi.fn(() => domApi);
    const graphql = vi.fn(() => gqlApi);
    createXListApi("rest", { rest, dom, graphql });
    expect(rest).toHaveBeenCalledTimes(1);
    expect(dom).not.toHaveBeenCalled();
    expect(graphql).not.toHaveBeenCalled();
  });
});
