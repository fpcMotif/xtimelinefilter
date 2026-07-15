// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

declare const process: { env: Record<string, string | undefined> };
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

const DEVICE_KEY = "test-device-key";
const modules = import.meta.glob("./**/*.*s");
const T0 = 1_700_000_000_000;

beforeEach(() => {
  process.env.LASSO_DEVICE_KEY = DEVICE_KEY;
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

const owner = { userId: "100", screenName: "operator" };

test("PROBE: raw db.patch with undefined deletes the field?", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("lists", { listId: "L1", name: "Builders", ownerUserId: "100", memberCount: 42, isPrivate: true }),
  );
  await t.run((ctx) => ctx.db.patch(id, { name: "Builders", ownerUserId: "100", memberCount: undefined, isPrivate: undefined }));
  const row = await t.run((ctx) => ctx.db.get(id));
  console.log("AFTER PATCH:", JSON.stringify(row));
  expect(row).toBeTruthy();
});

test("PROBE: reconcileCatalog(with counts) then recordAssign(without) — is memberCount wiped?", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.membership.reconcileCatalog, {
    deviceKey: DEVICE_KEY,
    owner,
    lists: [{ listId: "L1", name: "Builders", isPrivate: true, memberCount: 42 }],
  });
  const before = await t.run((ctx) => ctx.db.query("lists").collect());
  console.log("AFTER reconcileCatalog:", JSON.stringify(before));

  // recordAssign with a list arg that OMITS isPrivate/memberCount (the src listArg strips them)
  await t.mutation(api.membership.recordAssign, {
    deviceKey: DEVICE_KEY,
    owner,
    list: { listId: "L1", name: "Builders" },
    results: [{ memberScreenName: "alice", action: "add", outcome: "added" }],
  });
  const after = await t.run((ctx) => ctx.db.query("lists").collect());
  console.log("AFTER recordAssign:", JSON.stringify(after));
});
