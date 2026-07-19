import { describe, expect, it } from "vitest";

import { createListUsage } from "@/core/list-usage";
import type { StorageLike } from "@/core/storage-areas";

function memoryArea(): StorageLike {
  const store: Record<string, unknown> = {};
  return {
    async get() {
      return { ...store };
    },
    async set(items) {
      Object.assign(store, items);
    },
  };
}

describe("createListUsage", () => {
  it("isolates recent Lists by Owner", async () => {
    let t = 1000;
    const usage = createListUsage(memoryArea(), () => t++);
    await usage.record("owner-a", "shared");
    await usage.record("owner-b", "other");
    await usage.record("owner-b", "shared");

    expect(await usage.recentIds("owner-a", 5)).toEqual(["shared"]);
    expect(await usage.recentIds("owner-b", 5)).toEqual(["shared", "other"]);
  });

  it("caps results and omits never-used Lists", async () => {
    let t = 1000;
    const usage = createListUsage(memoryArea(), () => t++);
    await usage.record("owner", "1");
    await usage.record("owner", "3");
    await usage.record("owner", "2");

    expect(await usage.recentIds("owner", 2)).toEqual(["2", "3"]);
  });

  it("does not attribute legacy global usage to an Owner", async () => {
    const area = memoryArea();
    await area.set({ "lasso:list-usage": { "3": 4 } });
    const usage = createListUsage(area);

    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("drops malformed Owner-qualified usage", async () => {
    const area = memoryArea();
    await area.set({ "lasso:list-usage:owner": { schema: 2, entries: [] } });
    const usage = createListUsage(area);
    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("drops malformed Owner-List usage entries", async () => {
    const area = memoryArea();
    await area.set({
      "lasso:list-usage:owner:good": 1000,
      "lasso:list-usage:owner:bad": Number.POSITIVE_INFINITY,
    });
    const usage = createListUsage(area);

    expect(await usage.recentIds("owner", 5)).toEqual(["good"]);
  });

  it("ignores non-canonical encoded list keys", async () => {
    const area = memoryArea();
    await area.set({ "lasso:list-usage:owner:%2f": 1000 });
    const usage = createListUsage(area);

    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("ignores list keys with invalid percent encoding", async () => {
    const area = memoryArea();
    await area.set({ "lasso:list-usage:owner:%": 1000 });
    const usage = createListUsage(area);

    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("does not persist an invalid clock value", async () => {
    const area = memoryArea();
    const usage = createListUsage(area, () => Number.NaN);

    await usage.record("owner", "list");

    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("fails soft when usage storage returns a non-record payload", async () => {
    const area = {
      async get() {
        return [] as unknown as Record<string, unknown>;
      },
      async set() {},
    } satisfies StorageLike;
    const usage = createListUsage(area);

    expect(await usage.recentIds("owner", 5)).toEqual([]);
  });

  it("keeps concurrent records from independent contexts", async () => {
    const area = memoryArea();
    const first = createListUsage(area, () => 1000);
    const second = createListUsage(area, () => 1001);

    await Promise.all([first.record("owner", "first"), second.record("owner", "second")]);

    expect(await first.recentIds("owner", 5)).toEqual(["second", "first"]);
  });

  it("fails soft when usage storage is unavailable", async () => {
    const area: StorageLike = {
      async get() {
        throw new Error("storage unavailable");
      },
      async set() {
        throw new Error("storage unavailable");
      },
    };
    const usage = createListUsage(area);

    await expect(usage.record("owner", "list")).resolves.toBeUndefined();
    await expect(usage.recentIds("owner", 5)).resolves.toEqual([]);
  });
});
