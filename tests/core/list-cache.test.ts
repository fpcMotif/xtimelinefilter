import { describe, expect, it, vi } from "vitest";

import { createListCache } from "@/core/list-cache";
import type { XList } from "@/core/x-client/types";

const LISTS: XList[] = [
  { id: "1", name: "Research" },
  { id: "2", name: "Friends" },
];

describe("createListCache", () => {
  it("calls the loader once and serves subsequent calls from cache", async () => {
    const loader = vi.fn(async () => LISTS);
    const cache = createListCache(loader);
    await cache.lists();
    await cache.lists();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("refetches when forced", async () => {
    const loader = vi.fn(async () => LISTS);
    const cache = createListCache(loader);
    await cache.lists();
    await cache.lists({ force: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("ranks fuzzy matches with the tightest first", async () => {
    const cache = createListCache(async () => [
      { id: "1", name: "Research" },
      { id: "2", name: "Friends" },
      { id: "3", name: "Founders" },
    ]);
    // "re": Research (contiguous, score 0) then Friends (r…e, score 2); Founders has no e after r.
    expect((await cache.search("re")).map((l) => l.name)).toEqual(["Research", "Friends"]);
  });

  it("returns all lists for an empty query and nothing for no match", async () => {
    const cache = createListCache(async () => LISTS);
    expect((await cache.search("")).map((l) => l.name)).toEqual(["Research", "Friends"]);
    expect(await cache.search("zzz")).toEqual([]);
  });
});
