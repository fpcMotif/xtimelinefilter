import { describe, expect, it } from "vitest";

import { createChromeOpsCache } from "@/core/x-client/graphql-ops-chrome";

const KEY = "lasso.graphqlOps.v1";
const entry = {
  ops: { ListAddMember: "a", ListRemoveMember: "r", UserByScreenName: "u" },
  fetchedAt: 123,
};

describe("createChromeOpsCache", () => {
  it("round-trips a written entry", async () => {
    const cache = createChromeOpsCache();
    await cache.write(entry);
    await expect(cache.read()).resolves.toEqual(entry);
  });

  it("reads null when nothing is stored", async () => {
    await expect(createChromeOpsCache().read()).resolves.toBeNull();
  });

  it.each([
    ["null", null],
    ["a non-object", "junk"],
    ["an object without ops", { fetchedAt: 1 }],
    ["an object without fetchedAt", { ops: entry.ops }],
    ["a null ops map", { ops: null, fetchedAt: 1 }],
    ["a non-object ops map", { ops: "nope", fetchedAt: 1 }],
    [
      "a missing ListAddMember",
      { ops: { ListRemoveMember: "r", UserByScreenName: "u" }, fetchedAt: 1 },
    ],
    [
      "a missing ListRemoveMember",
      { ops: { ListAddMember: "a", UserByScreenName: "u" }, fetchedAt: 1 },
    ],
    [
      "a missing UserByScreenName",
      { ops: { ListAddMember: "a", ListRemoveMember: "r" }, fetchedAt: 1 },
    ],
    [
      "a non-string op id",
      { ops: { ListAddMember: 1, ListRemoveMember: "r", UserByScreenName: "u" }, fetchedAt: 1 },
    ],
    ["a non-numeric fetchedAt", { ops: entry.ops, fetchedAt: "now" }],
  ])("reads null for %s", async (_label, raw) => {
    await chrome.storage.local.set({ [KEY]: raw });
    await expect(createChromeOpsCache().read()).resolves.toBeNull();
  });
});
