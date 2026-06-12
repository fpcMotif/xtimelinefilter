import { describe, expect, it } from "vitest";

import { createListUsage } from "@/core/list-usage";
import type { StorageLike } from "@/core/settings";
import type { XList } from "@/core/x-client/types";

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

const lists: XList[] = [
  { id: "1", name: "AI" },
  { id: "2", name: "Friends" },
  { id: "3", name: "News" },
];

describe("createListUsage", () => {
  it("keeps API order when nothing has been picked", async () => {
    const usage = createListUsage(memoryArea());
    expect((await usage.rank(lists)).map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("ranks the most-picked list first", async () => {
    const usage = createListUsage(memoryArea());
    await usage.record("3");
    await usage.record("3");
    await usage.record("2");
    expect((await usage.rank(lists)).map((l) => l.id)).toEqual(["3", "2", "1"]);
  });

  it("breaks ties by original API order", async () => {
    const usage = createListUsage(memoryArea());
    await usage.record("2");
    await usage.record("3");
    expect((await usage.rank(lists)).map((l) => l.id)).toEqual(["2", "3", "1"]);
  });
});

describe("recency — the picker's Recent group (story beat 4)", () => {
  it("returns recently used ids, most recent first, capped by limit", async () => {
    let t = 1000;
    const usage = createListUsage(memoryArea(), () => t++);
    await usage.record("1");
    await usage.record("3");
    await usage.record("2");
    expect(await usage.recentIds(5)).toEqual(["2", "3", "1"]);
    expect(await usage.recentIds(2)).toEqual(["2", "3"]);
  });

  it("never-used lists do not appear in recents", async () => {
    const usage = createListUsage(memoryArea());
    await usage.record("2");
    expect(await usage.recentIds(5)).toEqual(["2"]);
  });

  it("reads legacy plain-number counts without losing rank", async () => {
    const area = memoryArea();
    await area.set({ "lasso:list-usage": { "3": 4, "1": 1 } });
    const usage = createListUsage(area);
    expect((await usage.rank(lists)).map((l) => l.id)).toEqual(["3", "1", "2"]);
    await usage.record("3"); // upgrade write keeps the old count
    expect((await usage.rank(lists)).map((l) => l.id)).toEqual(["3", "1", "2"]);
  });
});
