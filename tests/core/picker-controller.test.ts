import { describe, expect, it, vi } from "vitest";

import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import { XApiError, type XList } from "@/core/x-client/types";
import type { MembershipStore, Owner } from "@/packages/membership-store/types";

const OWNER: Owner = { userId: "100", screenName: "me" };
const LISTS: XList[] = [
  { id: "1", name: "Design Folks", memberCount: 1204 },
  { id: "2", name: "Founders" },
  { id: "3", name: "Friends", isPrivate: true },
];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeCache(options: {
  cached?: XList[] | null;
  fresh?: () => Promise<XList[]>;
}): ListCache {
  return {
    cached: async () => options.cached ?? null,
    refresh: options.fresh ?? (async () => options.cached ?? []),
  };
}

function picker(cache: ListCache, overrides = {}) {
  return createPickerController({
    cache,
    currentOwner: () => OWNER,
    ...overrides,
  });
}

describe("PickerController cache and errors", () => {
  it("keeps X usable when Owner discovery is unavailable", async () => {
    const cache = fakeCache({ cached: LISTS });
    const controller = createPickerController({
      cache,
      currentOwner: () => null,
    });
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value).toMatchObject({ status: "ready" });
    expect(controller.view.value.flat.map((row) => row.key)).toEqual([
      "1:current:1",
      "1:current:2",
      "1:current:3",
    ]);
    expect(controller.act({ type: "choose", rowKey: "1:current:1" })).toMatchObject({
      type: "chosen",
      owner: null,
      list: LISTS[0],
    });
  });

  it("captures authors in the view and chosen effect", async () => {
    const authors = [{ screenName: "jane" }];
    const controller = picker(fakeCache({ cached: LISTS }));
    await controller.open(authors);
    authors[0]!.screenName = "changed";

    expect(controller.view.value.authors).toEqual([{ screenName: "jane" }]);
    expect(Object.isFrozen(controller.view.value.authors[0])).toBe(true);
    expect(() => {
      (controller.view.value.authors[0] as { screenName: string }).screenName = "tampered";
    }).toThrow(TypeError);
    expect(controller.act({ type: "choose", rowKey: "1:100:1" })).toMatchObject({
      type: "chosen",
      authors: [{ screenName: "jane" }],
    });
  });

  it("publishes cache before the X refresh resolves", async () => {
    let release!: (lists: XList[]) => void;
    const fresh = new Promise<XList[]>((resolve) => {
      release = resolve;
    });
    const controller = picker(fakeCache({ cached: LISTS, fresh: () => fresh }));

    const opening = controller.open([{ screenName: "jane" }]);
    await flush();
    expect(controller.view.value.status).toBe("ready");
    expect(controller.view.value.flat.map((row) => row.list.id)).toEqual(["1", "2", "3"]);
    release([...LISTS, { id: "4", name: "New" }]);
    await opening;
    expect(controller.view.value.flat.map((row) => row.list.id)).toEqual(["1", "2", "3", "4"]);
  });

  it("publishes fresh X results without waiting for a hung cache", async () => {
    let release!: (lists: XList[]) => void;
    const fresh = new Promise<XList[]>((resolve) => {
      release = resolve;
    });
    const controller = picker({
      cached: () => new Promise<XList[] | null>(() => {}),
      refresh: () => fresh,
    });

    const opening = controller.open([{ screenName: "jane" }]);
    release(LISTS);
    const outcome = await Promise.race([
      opening.then(() => "opened"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);

    expect(outcome).toBe("opened");
    expect(controller.view.value.flat.map((row) => row.list.id)).toEqual(["1", "2", "3"]);
    expect(controller.view.value.flat[0]?.access).toEqual({
      kind: "writable",
      freshness: "live",
    });
  });

  it("does not let a late cache read replace the live catalog", async () => {
    let resolveCached!: (lists: XList[] | null) => void;
    const cached = new Promise<XList[] | null>((resolve) => {
      resolveCached = resolve;
    });
    const controller = picker({
      cached: () => cached,
      refresh: async () => [{ id: "fresh", name: "Fresh" }],
    });

    await controller.open([{ screenName: "jane" }]);
    resolveCached(LISTS);
    await flush();

    expect(controller.view.value.flat.map((row) => row.list.id)).toEqual(["fresh"]);
  });

  it("treats a successful empty X answer as authoritative", async () => {
    const controller = picker(fakeCache({ cached: LISTS, fresh: async () => [] }));
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value.status).toBe("empty");
    expect(controller.view.value.flat).toEqual([]);
  });

  it.each([
    ["auth", "auth"],
    ["rate-limited", "rate-limited"],
    ["not-found", "unknown"],
  ] as const)("maps %s X failures to %s", async (kind, expected) => {
    const controller = picker(
      fakeCache({
        fresh: async () => {
          throw new XApiError(kind, "failed");
        },
      }),
    );
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value.status).toBe("error");
    expect(controller.view.value.errorKind).toBe(expected);
  });

  it("keeps usable cache when X refresh fails", async () => {
    const controller = picker(
      fakeCache({
        cached: LISTS,
        fresh: async () => {
          throw new Error("offline");
        },
      }),
    );
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value.status).toBe("ready");
    expect(controller.view.value.flat).toHaveLength(3);
  });

  it("retry starts a new generation and recovers", async () => {
    let fail = true;
    const controller = picker(
      fakeCache({
        fresh: async () => {
          if (fail) throw new Error("offline");
          return LISTS;
        },
      }),
    );
    await controller.open([{ screenName: "jane" }]);
    fail = false;
    controller.act({ type: "retry" });
    await flush();
    expect(controller.view.value.status).toBe("ready");
  });
});

describe("PickerController projection", () => {
  it("groups recent Lists and navigates the rendered order", async () => {
    const controller = picker(fakeCache({ cached: LISTS }), {
      recentIds: async () => ["3"],
    });
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value.groups.map((group) => group.label)).toEqual([
      "Recent",
      "All Lists",
    ]);
    expect(controller.view.value.flat.map((row) => row.list.id)).toEqual(["3", "1", "2"]);
    controller.act({ type: "move", direction: "down" });
    expect(controller.view.value.active?.list.id).toBe("1");
    controller.act({ type: "move", direction: "up" });
    expect(controller.view.value.active?.list.id).toBe("3");
  });

  it("filters fuzzily, resets the cursor, and exposes no-match", async () => {
    const controller = picker(fakeCache({ cached: LISTS }));
    await controller.open([{ screenName: "jane" }]);
    controller.act({ type: "move", direction: "down" });
    controller.act({ type: "query", value: "fr" });
    expect(controller.view.value.flat.map((row) => row.list.name)).toEqual(["Friends", "Founders"]);
    expect(controller.view.value.activeIndex).toBe(0);
    controller.act({ type: "query", value: "zzz" });
    expect(controller.view.value.noMatch).toBe(true);
    expect(controller.view.value.status).toBe("ready");
  });

  it("ignores failed recency data", async () => {
    const controller = picker(fakeCache({ cached: LISTS }), {
      recentIds: async () => {
        throw new Error("storage failed");
      },
    });
    await controller.open([{ screenName: "jane" }]);
    expect(controller.view.value.groups.map((group) => group.label)).toEqual([null]);
  });

  it("skips the X membership read for bulk selection", async () => {
    const memberships = vi.fn(async () => ["1"]);
    const controller = picker(fakeCache({ cached: LISTS }), {
      memberships,
      membershipStore: {
        recordAssign: async () => {},
        reconcileAuthor: async () => {},
        replaceCatalog: async () => {},
        observe: () => () => {},
      },
    });
    await controller.open([{ screenName: "a" }, { screenName: "b" }]);
    expect(memberships).not.toHaveBeenCalled();
  });

  it("keeps empty navigation inert", async () => {
    const controller = picker(fakeCache({ cached: [] }));
    await controller.open([{ screenName: "jane" }]);
    controller.act({ type: "move", direction: "down" });
    expect(controller.view.value.active).toBeNull();
  });
});

describe("PickerController generations", () => {
  it("rejects a row key from an earlier open", async () => {
    const controller = picker(fakeCache({ cached: LISTS }));
    await controller.open([{ screenName: "jane" }]);
    const staleKey = controller.view.value.flat[0]!.key;

    await controller.open([{ screenName: "jane" }]);
    const freshKey = controller.view.value.flat[0]!.key;

    expect(freshKey).not.toBe(staleKey);
    expect(controller.act({ type: "choose", rowKey: staleKey })).toBeNull();
  });

  it("does not Reconcile stale membership work after it is superseded", async () => {
    let release!: (ids: string[]) => void;
    let first = true;
    const memberships = async () => {
      if (!first) return [];
      first = false;
      return new Promise<string[]>((resolve) => {
        release = resolve;
      });
    };
    const replaceCatalog = vi.fn(async () => {});
    const reconcileAuthor = vi.fn(
      async (..._args: Parameters<MembershipStore["reconcileAuthor"]>) => {},
    );
    const controller = picker(fakeCache({ cached: LISTS }), {
      memberships,
      membershipStore: {
        recordAssign: async () => {},
        reconcileAuthor,
        replaceCatalog,
        observe: () => () => {},
      },
    });
    const stale = controller.open([{ screenName: "jane", tweetId: "tweet-jane" }]);
    await vi.waitFor(() => expect(replaceCatalog).toHaveBeenCalledOnce());
    await controller.open([{ screenName: "bob", tweetId: "tweet-bob" }]);
    release([]);
    await stale;
    expect(replaceCatalog).toHaveBeenCalledTimes(2);
    expect(reconcileAuthor).toHaveBeenCalledOnce();
    expect(reconcileAuthor.mock.calls[0]?.[1]).toMatchObject({ screenName: "bob" });
  });

  it("ignores stale catalog and membership results from a superseded open", async () => {
    let owner = OWNER;
    let release!: (lists: XList[]) => void;
    const first = new Promise<XList[]>((resolve) => {
      release = resolve;
    });
    let refreshes = 0;
    const cache: ListCache = {
      cached: async () => null,
      refresh: async () => (++refreshes === 1 ? first : [{ id: "B", name: "Bob" }]),
    };
    const controller = createPickerController({
      cache,
      currentOwner: () => owner,
    });
    const stale = controller.open([{ screenName: "jane" }]);
    owner = { userId: "200", screenName: "bob" };
    await controller.open([{ screenName: "bob" }]);
    release([{ id: "A", name: "Stale" }]);
    await stale;

    expect(controller.view.value.flat.map((row) => row.key)).toEqual(["2:200:B"]);
    expect(controller.view.value.flat[0]?.access.kind).toBe("writable");
  });
});
