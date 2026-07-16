import { describe, expect, it, vi } from "vitest";

import { type ListDiscovery, ListDiscoveryError } from "@/core/list-discovery";
import { createPickerController } from "@/core/picker-controller";
import type { XList } from "@/core/x-client/types";

const LISTS: XList[] = [
  { id: "1", name: "Design Folks", memberCount: 1204 },
  { id: "2", name: "Founders" },
  { id: "3", name: "Friends", isPrivate: true },
];

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Fake ListDiscovery: `cached` is shown immediately; `fresh` supplies the background
 * refresh (ownedLists) and the forced retry (refresh). Cache mechanics live inside
 * discovery, so the fake mirrors that seam — not a cache.
 */
function fakeDiscovery(opts: {
  cached?: XList[] | null;
  fresh?: () => Promise<XList[]>;
  membership?: (screenName: string) => Promise<string[]>;
}): ListDiscovery & { freshCalls: number } {
  const fresh = opts.fresh ?? (async () => opts.cached ?? []);
  const api = {
    freshCalls: 0,
    async ownedLists({ onRefresh }: { onRefresh?: (lists: XList[]) => void } = {}) {
      if (opts.cached?.length) {
        if (onRefresh) {
          void Promise.resolve()
            .then(fresh)
            .then((latest) => {
              api.freshCalls++;
              if (latest.length > 0) onRefresh(latest);
            })
            .catch(() => {});
        }
        return opts.cached;
      }
      api.freshCalls++;
      return fresh(); // cold cache: the initial load is the fresh load
    },
    async refresh() {
      api.freshCalls++;
      return fresh();
    },
    async membership(screenName: string) {
      return opts.membership ? opts.membership(screenName) : [];
    },
  };
  return api;
}

describe("createPickerController — cache-first open (story beat 4)", () => {
  it("opens ready from cache instantly, then refreshes in the background", async () => {
    const fresh = vi.fn(async () => [...LISTS, { id: "4", name: "New" }]);
    const discovery = fakeDiscovery({ cached: LISTS, fresh });
    const picker = createPickerController({ discovery });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("ready");
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3"]);
    await flush(); // silent refresh lands in the background
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(picker.flat.value.map((l) => l.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("true empty (no Lists anywhere) → empty state", async () => {
    const picker = createPickerController({ discovery: fakeDiscovery({ cached: null }) });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("empty");
  });

  it("auth failure → error state naming the cause", async () => {
    const discovery = fakeDiscovery({
      cached: null,
      fresh: async () => {
        throw new ListDiscoveryError("auth", "401");
      },
    });
    const picker = createPickerController({ discovery });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.status.value).toBe("error");
    expect(picker.errorKind.value).toBe("auth");
  });

  it("rate-limited fetch → error state with the rate-limit reason", async () => {
    const discovery = fakeDiscovery({
      cached: null,
      fresh: async () => {
        throw new ListDiscoveryError("rate-limited", "429");
      },
    });
    const picker = createPickerController({ discovery });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.errorKind.value).toBe("rate-limited");
  });

  it("retry() recovers from error to ready", async () => {
    let fail = true;
    const discovery = fakeDiscovery({
      cached: null,
      fresh: async () => {
        if (fail) throw new ListDiscoveryError("auth", "401");
        return LISTS;
      },
    });
    const picker = createPickerController({ discovery });
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
      discovery: fakeDiscovery({ cached: LISTS }),
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
      discovery: fakeDiscovery({ cached: LISTS }),
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
    const picker = createPickerController({ discovery: fakeDiscovery({ cached: LISTS }) });
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
    const membership = vi.fn(async () => ["1"]);
    const picker = createPickerController({
      discovery: fakeDiscovery({ cached: LISTS, membership }),
    });
    await picker.open([{ screenName: "jane" }]);
    await flush();
    expect(membership).toHaveBeenCalledWith("jane");
    expect(picker.alreadyIn.value.has("1")).toBe(true);
  });

  it("skips the membership lookup for bulk selections", async () => {
    const membership = vi.fn(async () => ["1"]);
    const picker = createPickerController({
      discovery: fakeDiscovery({ cached: LISTS, membership }),
    });
    await picker.open([{ screenName: "a" }, { screenName: "b" }]);
    await flush();
    expect(membership).not.toHaveBeenCalled();
    expect(picker.alreadyIn.value.size).toBe(0);
  });

  it("a membership/recents helper that throws synchronously never breaks open()", async () => {
    // auth.credentials() throws synchronously when logged out — the throw must
    // not escape open() (which callers invoke as `void picker.open(...)`).
    const picker = createPickerController({
      discovery: fakeDiscovery({
        cached: LISTS,
        membership: () => {
          throw new Error("logged out");
        },
      }),
      recentIds: () => {
        throw new Error("logged out");
      },
    });
    await expect(picker.open([{ screenName: "jane" }])).resolves.toBeUndefined();
    expect(picker.status.value).toBe("ready");
    expect(picker.alreadyIn.value.size).toBe(0);
  });
});
