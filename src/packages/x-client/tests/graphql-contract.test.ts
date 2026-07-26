import { describe, expect, it } from "vitest";

import { isGraphqlCatalog, isGraphqlQueryId } from "@/packages/x-client/graphql-contract";

const catalog = {
  ListAddMember: { queryId: "add", features: {} },
  ListRemoveMember: { queryId: "remove", features: {} },
  UserByScreenName: { queryId: "user", features: {} },
};

describe("GraphQL operation contract", () => {
  it("accepts exactly the complete catalog", () => {
    expect(isGraphqlCatalog(catalog)).toBe(true);
  });

  it.each([
    { ...catalog, unexpected: {} },
    { ListAddMember: catalog.ListAddMember, ListRemoveMember: catalog.ListRemoveMember },
    { ...catalog, ListAddMember: { ...catalog.ListAddMember, extra: true } },
    { ...catalog, ListAddMember: { queryId: "a/../b", features: {} } },
    { ...catalog, ListAddMember: { queryId: "add", features: { flag: "true" } } },
    {
      ...catalog,
      ListAddMember: { queryId: "add", features: { ["x".repeat(129)]: true } },
    },
    {
      ...catalog,
      ListAddMember: {
        queryId: "add",
        features: Object.fromEntries(
          Array.from({ length: 201 }, (_, index) => [String(index), true]),
        ),
      },
    },
  ])("rejects malformed catalog %#", (value) => {
    expect(isGraphqlCatalog(value)).toBe(false);
  });

  it("rejects query IDs that could escape a URL path", () => {
    expect(isGraphqlQueryId("a/../b")).toBe(false);
  });
});
