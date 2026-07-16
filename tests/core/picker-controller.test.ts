import { describe, expect, it, vi } from "vitest";

import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import { XApiError, type XList } from "@/core/x-client/types";

const LISTS: XList[] = [
  { id: "1", name: "Design Folks", memberCount: 1204 },
  { id: "2", name: "Founders" },
  { id: "3", name: "Friends", isPrivate: true },
];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Fake ListCache: `cached` is returned for non-forced reads; `fresh` for forced. */
function fakeCache(opts: {
  cached?: XList[] | null;
  fresh?: () => Promise<XList[]>;
}): ListCache & { forcedCalls: number } {
  const fresh = opts.fresh ?? (async () => opts.cached ?? []);
  const api = {
    forcedCalls: 0,
    async lists({ force = false }: { force?: boolean } = {}) {
      if (force) {
        api.forcedCalls++;
        return fresh();
      }
      if (opts.cached?.length) return opts.cached;
      return fresh();
    },
    async search() {
      return [];
    },
  };
  return api;
}

describe("createPickerController — cache-first open (story beat 4)", () => {
  it("opens ready from cache instantly, then refreshes in the background", async () => {
    const fresh = vi.fn(async () => [...LISTS, { id: "4", name: "New" }]);
    const cache = fakeCache({ cached: LISTS, fresh });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("ready");
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
    await flush(); // background force-refresh lands silently
    expect(cache.forcedCalls).toBe(1);
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("true empty (no Lists anywhere) → empty state", async () => {
    const picker = createPickerController({ cache: fakeCache({ cached: null }) });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("empty");
  });

  it("auth failure → error state naming the cause", async () => {
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        throw new XApiError("auth", "401");
      },
    });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("error");
    expect(picker.errorKind.value).toBe("auth");
  });

  it("rate-limited fetch → error state with the rate-limit reason", async () => {
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        throw new XApiError("rate-limited", "429");
      },
    });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.errorKind.value).toBe("rate-limited");
  });

  it("retry() recovers from error to ready", async () => {
    let fail = true;
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        if (fail) throw new XApiError("auth", "401");
        return LISTS;
      },
    });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("error");
    fail = false;
    await picker.retry();
    expect(picker.status.value).toBe("ready");
  });
});

describe("groups, fuzzy and navigation", () => {
  it("groups recently used Lists under Recent, the rest under All Lists", async () => {
    const picker = createPickerController({
      cache: fakeCache({ cached: LISTS }),
      recentIds: async () => ["3"],
    });
    await picker.open([{ screenName: "jane" }]);
    const groups = picker.groups.value;
    expect(groups.map((g) => g.label)).toEqual(["Recent", "All Lists"]);
    expect(groups[0]?.rows.map((l) => l.id)).toEqual(["3"]);
    expect(groups[1]?.rows.map((l) => l.id)).toEqual(["1", "2"]);
    // navigation order follows the visual order
    expect(picker.flat.value.map((l) => l.id)).toEqual(["3", "1", "2"]);
  });

  it("typing filters fuzzily across every list and resets the cursor", async () => {
    const picker = createPickerController({
      cache: fakeCache({ cached: LISTS }),
      recentIds: async () => ["2"],
    });
    await picker.open([{ screenName: "jane" }]);
    picker.moveDown();
    picker.setQuery("fr");
    expect(picker.flat.value.map((l) => l.name)).toEqual(["Friends", "Founders"]);
    expect(picker.activeIndex.value).toBe(0);
    picker.moveDown();
    expect(picker.active.value?.name).toBe("Founders");
  });

  it("moveUp/moveDown walk the flat order and clamp at the ends", async () => {
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }) });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.active.value?.id).toBe("1");
    picker.moveUp(); // already at the top — clamps
    expect(picker.activeIndex.value).toBe(0);
    picker.moveDown();
    picker.moveDown();
    expect(picker.active.value?.id).toBe("3");
    picker.moveDown(); // already at the bottom — clamps
    expect(picker.active.value?.id).toBe("3");
    picker.moveUp();
    expect(picker.active.value?.id).toBe("2");
  });

  it("no-match is its own state, distinct from empty", async () => {
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }) });
    await picker.open([{ screenName: "jane" }]);
    picker.setQuery("zzz");
    expect(picker.noMatch.value).toBe(true);
    expect(picker.status.value).toBe("ready");
    picker.setQuery("");
    expect(picker.noMatch.value).toBe(false);
  });
});

describe("already-in membership checks", () => {
  it("loads membership ids for a single selected person", async () => {
    const memberships = vi.fn(async () => ["1"]);
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }), memberships });
    await picker.open([{ screenName: "jane" }]);
    await flush();
    expect(memberships).toHaveBeenCalledWith("jane");
    expect(picker.alreadyIn.value.has("1")).toBe(true);
  });

  it("skips the membership lookup for bulk selections", async () => {
    const memberships = vi.fn(async () => ["1"]);
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }), memberships });
    await picker.open([{ screenName: "a" }, { screenName: "b" }]);
    await flush();
    expect(memberships).not.toHaveBeenCalled();
    expect(picker.alreadyIn.value.size).toBe(0);
  });

  it("a membership/recents helper that throws synchronously never breaks open()", async () => {
    // auth.credentials() throws synchronously when logged out — the throw must
    // not escape open() (which callers invoke as `void picker.open(...)`).
    const picker = createPickerController({
      cache: fakeCache({ cached: LISTS }),
      recentIds: () => {
        throw new Error("logged out");
      },
      memberships: () => {
        throw new Error("logged out");
      },
    });
    await expect(picker.open([{ screenName: "jane" }])).resolves.toBeUndefined();
    expect(picker.status.value).toBe("ready");
    expect(picker.alreadyIn.value.size).toBe(0);
  });
});

describe("edge cases — empty navigation, errors, background + superseded opens", () => {
  it("navigating an empty picker stays put and has no active row", async () => {
    const picker = createPickerController({ cache: fakeCache({ cached: null }) });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("empty");
    expect(picker.flat.value).toEqual([]);
    expect(picker.active.value).toBeNull();
    picker.moveDown();
    picker.moveUp();
    expect(picker.activeIndex.value).toBe(0);
    expect(picker.active.value).toBeNull();
  });

  it("a non-typed failure → unknown error kind", async () => {
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        throw new Error("network down");
      },
    });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("error");
    expect(picker.errorKind.value).toBe("unknown");
  });

  it("an XApiError of an unmapped kind → unknown error kind", async () => {
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        throw new XApiError("not-found", "404");
      },
    });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.errorKind.value).toBe("unknown");
  });

  it("a second open with lists already loaded shows ready immediately (no loading flash)", async () => {
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }) });
    await picker.open([{ screenName: "jane" }]);
    await flush();
    const second = picker.open([{ screenName: "bob" }]);
    expect(picker.status.value).toBe("ready"); // synchronous — lists already present
    await second;
  });

  it("a background refresh that returns nothing leaves the cached lists intact", async () => {
    const fresh = vi.fn(async () => [] as XList[]);
    const cache = fakeCache({ cached: LISTS, fresh });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
    await flush();
    expect(cache.forcedCalls).toBe(1);
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("a background refresh that rejects never disturbs the visible picker", async () => {
    const fresh = vi.fn(async () => {
      throw new Error("flaky");
    });
    const cache = fakeCache({ cached: LISTS, fresh });
    const picker = createPickerController({ cache });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("ready");
    await flush();
    expect(picker.status.value).toBe("ready");
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("a superseded open's stale cache result is ignored (generation guard)", async () => {
    let release!: (lists: XList[]) => void;
    const gate = new Promise<XList[]>((r) => {
      release = r;
    });
    let firstCall = true;
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        if (firstCall) {
          firstCall = false;
          return gate; // first open hangs until released
        }
        return LISTS;
      },
    });
    const picker = createPickerController({ cache });
    const first = picker.open([{ screenName: "jane" }]); // awaits the hung gate
    await picker.open([{ screenName: "bob" }]); // bumps generation, lands LISTS
    expect(picker.status.value).toBe("ready");
    release([{ id: "9", name: "Stale" }]); // first open resolves under a newer gen
    await first;
    await flush();
    // The stale single-row result must NOT have replaced the fresh LISTS.
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("a superseded open's failure never flips the visible picker to error", async () => {
    let reject!: (e: unknown) => void;
    const gate = new Promise<XList[]>((_r, rej) => {
      reject = rej;
    });
    let firstCall = true;
    const cache = fakeCache({
      cached: null,
      fresh: async () => {
        if (firstCall) {
          firstCall = false;
          return gate; // first open hangs, then rejects
        }
        return LISTS;
      },
    });
    const picker = createPickerController({ cache });
    const first = picker.open([{ screenName: "jane" }]); // awaits the hung gate
    await picker.open([{ screenName: "bob" }]); // bumps generation, lands LISTS
    expect(picker.status.value).toBe("ready");
    reject(new XApiError("auth", "401")); // first open fails under a newer generation
    await first;
    await flush();
    // The stale failure must NOT overwrite the ready state with an error.
    expect(picker.status.value).toBe("ready");
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
  });

  it("a superseded open's recents result is ignored (no stale Recent group)", async () => {
    let release!: (ids: string[]) => void;
    const gate = new Promise<string[]>((r) => {
      release = r;
    });
    let first = true;
    const picker = createPickerController({
      cache: fakeCache({ cached: LISTS }),
      recentIds: async () => {
        if (first) {
          first = false;
          return gate; // first open hangs on recents
        }
        return [];
      },
    });
    const firstOpen = picker.open([{ screenName: "jane" }]);
    await picker.open([{ screenName: "bob" }]); // bumps generation past the parked open
    release(["3"]); // first open resumes under a stale generation
    await firstOpen;
    await flush();
    expect(picker.groups.value.map((g) => g.label)).toEqual([null]); // no Recent group
  });

  it("a superseded open's membership result never marks rows already-in", async () => {
    let release!: (ids: string[]) => void;
    const gate = new Promise<string[]>((r) => {
      release = r;
    });
    let first = true;
    const memberships = vi.fn(async () => {
      if (first) {
        first = false;
        return gate; // first open's membership hangs
      }
      return [] as string[];
    });
    const picker = createPickerController({ cache: fakeCache({ cached: LISTS }), memberships });
    const firstOpen = picker.open([{ screenName: "jane" }]);
    await firstOpen; // load resolves (cache is immediate); membership still pending
    await picker.open([{ screenName: "bob" }]); // bumps generation
    await flush();
    release(["1"]); // jane's membership resolves under a stale generation
    await flush();
    expect(picker.alreadyIn.value.size).toBe(0);
  });
});
