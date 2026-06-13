import { describe, expect, it } from "vitest";

import { NullMembershipStore } from "@/core/membership-store/null";
import type { MembershipStore, Owner } from "@/core/membership-store/types";

const owner: Owner = { userId: "1", screenName: "me" };
const list = { id: "L1", name: "List" };

describe("NullMembershipStore (Mirror disabled)", () => {
  const store: MembershipStore = new NullMembershipStore();

  it("reads are always empty", async () => {
    expect(await store.listsContaining("jane")).toEqual([]);
    expect(await store.catalog()).toEqual([]);
  });

  it("writes resolve without throwing", async () => {
    await expect(store.recordAssign(owner, list, [])).resolves.toBeUndefined();
    await expect(store.reconcileAuthor(owner, "jane", ["L1"])).resolves.toBeUndefined();
    await expect(store.reconcileCatalog(owner, [list])).resolves.toBeUndefined();
  });
});
