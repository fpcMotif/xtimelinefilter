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
