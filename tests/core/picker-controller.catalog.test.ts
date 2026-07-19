import { describe, expect, it, vi } from "vitest";

import type { ListCache } from "@/core/list-cache";
import type {
  CompleteCatalogSnapshot,
  MembershipPerson,
  MembershipStore,
  ObservedMembershipSnapshot,
  Owner,
} from "@/core/membership-store/types";
import { createPickerController } from "@/core/picker-controller";
import type { XList } from "@/core/x-client/types";

const ACTIVE: Owner = { userId: "100", screenName: "me" };
const FOREIGN: Owner = { userId: "200", screenName: "alt" };
const ACTIVE_LIST: XList = { id: "A1", name: "Active" };
const FOREIGN_LIST: XList = { id: "F1", name: "Foreign" };

function cache(cached: XList[] | null, fresh: XList[] = cached ?? []): ListCache {
  return { cached: async () => cached, refresh: async () => fresh };
}

function mirror(overrides: Partial<MembershipStore> = {}): MembershipStore {
  const result = {
    async recordAssign() {},
    async reconcileAuthor() {},
    async replaceCatalog() {},
    ...overrides,
  } as MembershipStore;
  result.observe =
    overrides.observe ??
    ((_subject, emit) => {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          emit({
            catalog: [{ owner: FOREIGN, lists: [FOREIGN_LIST], lastReconciledAt: 123 }],
            memberships: [],
          });
        }
      });
      return () => {
        active = false;
      };
    });
  return result;
}

describe("PickerController catalog seam", () => {
  it("reopens instead of publishing cached Lists for a stale Owner", async () => {
    let owner = ACTIVE;
    let releaseCached!: (lists: XList[]) => void;
    let releaseRefresh!: (lists: XList[]) => void;
    let releaseMembership!: (ids: string[]) => void;
    const staleCached = new Promise<XList[]>((resolve) => {
      releaseCached = resolve;
    });
    const staleRefresh = new Promise<XList[]>((resolve) => {
      releaseRefresh = resolve;
    });
    const staleMembership = new Promise<string[]>((resolve) => {
      releaseMembership = resolve;
    });
    let reads = 0;
    let membershipReads = 0;
    const picker = createPickerController({
      cache: {
        cached: async () => (++reads === 1 ? staleCached : [FOREIGN_LIST]),
        refresh: async () => (reads === 1 ? staleRefresh : [FOREIGN_LIST]),
      },
      currentOwner: () => owner,
      membershipStore: mirror({ observe: () => () => {} }),
      memberships: async () => (++membershipReads === 1 ? staleMembership : []),
    });

    const opening = picker.open([{ screenName: "jane" }]);
    owner = FOREIGN;
    releaseCached([ACTIVE_LIST]);
    releaseRefresh([ACTIVE_LIST]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseMembership([]);
    await opening;

    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
  });

  it("reopens when an old Owner's refresh fails", async () => {
    let owner = ACTIVE;
    let rejectRefresh!: (error: Error) => void;
    let releaseMembership!: (ids: string[]) => void;
    const staleRefresh = new Promise<XList[]>((_, reject) => {
      rejectRefresh = reject;
    });
    const staleMembership = new Promise<string[]>((resolve) => {
      releaseMembership = resolve;
    });
    let refreshes = 0;
    let membershipReads = 0;
    const picker = createPickerController({
      cache: {
        cached: async () => null,
        refresh: async () => (++refreshes === 1 ? staleRefresh : [FOREIGN_LIST]),
      },
      currentOwner: () => owner,
      membershipStore: mirror({ observe: () => () => {} }),
      memberships: async () => (++membershipReads === 1 ? staleMembership : []),
    });

    const opening = picker.open([{ screenName: "jane" }]);
    owner = FOREIGN;
    rejectRefresh(new Error("stale network failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseMembership([]);
    await opening;

    expect(picker.view.value).toMatchObject({ status: "ready" });
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
  });

  it("reopens before a Mirror catalog write if Owner changes after reads settle", async () => {
    let owner = ACTIVE;
    const replaceCatalog = vi.fn(async (_owner: Owner, _snapshot: CompleteCatalogSnapshot) => {});
    const picker = createPickerController({
      cache: {
        cached: async (candidate) => (candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : []),
        refresh: async (candidate) => {
          if (candidate?.userId === ACTIVE.userId) {
            owner = FOREIGN;
            return [ACTIVE_LIST];
          }
          return [FOREIGN_LIST];
        },
      },
      currentOwner: () => owner,
      membershipStore: mirror({ observe: () => () => {}, replaceCatalog }),
      memberships: async () => [ACTIVE_LIST.id],
    });

    await picker.open([{ screenName: "jane", userId: "7" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replaceCatalog.mock.calls.map(([candidate]) => candidate.userId)).not.toContain("100");
  });

  it("reopens before author Reconcile when catalog Reconcile sees an Owner switch", async () => {
    let owner = ACTIVE;
    const replaceCatalog = vi.fn(async (candidate: Owner, _snapshot: CompleteCatalogSnapshot) => {
      if (candidate.userId === ACTIVE.userId) owner = FOREIGN;
    });
    const reconcileAuthor = vi.fn(async (_owner: Owner) => {});
    const picker = createPickerController({
      cache: {
        cached: async (candidate) =>
          candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : [FOREIGN_LIST],
        refresh: async () => (owner.userId === ACTIVE.userId ? [ACTIVE_LIST] : [FOREIGN_LIST]),
      },
      currentOwner: () => owner,
      membershipStore: mirror({
        observe: () => () => {},
        replaceCatalog,
        reconcileAuthor,
      }),
      memberships: async () => [ACTIVE_LIST.id],
    });

    await picker.open([{ screenName: "jane", userId: "7" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(replaceCatalog.mock.calls.map(([candidate]) => candidate.userId)).toEqual([
      "100",
      "200",
    ]);
    expect(reconcileAuthor.mock.calls.map(([candidate]) => candidate.userId)).toEqual(["200"]);
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
  });

  it("does not Reconcile an author after the Picker closes during catalog Reconcile", async () => {
    let picker!: ReturnType<typeof createPickerController>;
    const reconcileAuthor = vi.fn(
      async (_owner: Owner, _person: MembershipPerson, _snapshot: ObservedMembershipSnapshot) => {},
    );
    picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe: () => () => {},
        replaceCatalog: async () => {
          picker.act({ type: "close" });
        },
        reconcileAuthor,
      }),
      memberships: async () => [ACTIVE_LIST.id],
    });

    await picker.open([{ screenName: "jane", tweetId: "post-1" }]);

    expect(reconcileAuthor).not.toHaveBeenCalled();
  });

  it("does not construct a Mirror observation without an Owner", async () => {
    const observe = vi.fn(() => () => {});
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => null,
      membershipStore: mirror({ observe }),
    });

    await picker.open([{ screenName: "jane" }]);
    expect(observe).not.toHaveBeenCalled();
    expect(picker.view.value.flat).toHaveLength(1);
  });

  it("does not make an active Owner Mirror catalog writable before X answers", async () => {
    const pending = new Promise<XList[]>(() => {});
    const picker = createPickerController({
      cache: { cached: async () => null, refresh: async () => pending },
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [{ owner: ACTIVE, lists: [ACTIVE_LIST], lastReconciledAt: 1 }],
            memberships: [],
          });
          return () => {};
        },
      }),
    });
    void picker.open([{ screenName: "jane" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker.view.value).toMatchObject({ status: "loading" });
    expect(picker.view.value.flat).toEqual([]);
  });

  it("does not let an active Owner Mirror catalog hide an X failure", async () => {
    const picker = createPickerController({
      cache: {
        cached: async () => null,
        refresh: async () => {
          throw new Error("X offline");
        },
      },
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [{ owner: ACTIVE, lists: [ACTIVE_LIST], lastReconciledAt: 1 }],
            memberships: [],
          });
          return () => {};
        },
      }),
    });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.view.value.status).toBe("error");
    expect(picker.view.value.flat).toEqual([]);
  });

  it("applies live Mirror snapshots only while open", async () => {
    let publish!: Parameters<MembershipStore["observe"]>[1];
    const store = mirror({
      observe(_subject, emit) {
        publish = emit;
        return () => {};
      },
    });
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: store,
    });
    await picker.open([{ screenName: "jane" }]);
    publish({
      catalog: [{ owner: FOREIGN, lists: [{ id: "F2", name: "Live" }] }],
      memberships: [
        {
          ownerUserId: FOREIGN.userId,
          listId: "F2",
          present: true,
          lastSeenAt: 999,
        },
      ],
    });
    picker.act({ type: "select-scope", scope: { kind: "all" } });
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:100:A1", "1:200:F2"]);
    picker.act({ type: "move", direction: "down" });
    publish({
      catalog: [{ owner: FOREIGN, lists: [{ id: "F3", name: "Replacement" }] }],
      memberships: [],
    });
    expect(picker.view.value.active?.key).toBe("1:100:A1");

    picker.act({ type: "close" });
    publish({ catalog: [], memberships: [] });
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:100:A1", "1:200:F3"]);
  });

  it("sorts foreign Owners and projects cached absence", async () => {
    const ALPHA: Owner = { userId: "300", screenName: "alpha" };
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [
              { owner: FOREIGN, lists: [FOREIGN_LIST] },
              { owner: ALPHA, lists: [{ id: "A2", name: "Alpha" }] },
            ],
            memberships: [
              {
                ownerUserId: ALPHA.userId,
                listId: "A2",
                present: false,
                lastSeenAt: 5,
              },
            ],
          });
          return () => {};
        },
      }),
    });
    await picker.open([{ screenName: "jane", userId: "7" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });
    expect(picker.view.value.owners.map((tab) => tab.owner.screenName)).toEqual([
      "me",
      "alpha",
      "alt",
    ]);
    expect(picker.view.value.flat.find((row) => row.key === "1:300:A2")?.membership).toEqual({
      kind: "absent",
      source: "mirror-cached",
      asOf: 5,
    });
  });

  it("qualifies rows by Owner and leaves a foreign direct choose inert", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror(),
    });

    await picker.open([{ screenName: "jane" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });

    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:100:A1", "1:200:F1"]);
    expect(picker.view.value.flat.map((row) => row.access.kind)).toEqual(["writable", "read-only"]);
    expect(picker.act({ type: "choose", rowKey: "1:200:F1" })).toBeNull();
    expect(picker.act({ type: "choose", rowKey: "missing" })).toBeNull();
  });

  it("uses private policy when a foreign render row is tampered", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror(),
    });
    await picker.open([{ screenName: "jane" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });
    const rendered = picker.view.value.flat.find((row) => row.key === "1:200:F1")!;
    (rendered as { access: { kind: "writable"; freshness: "live" } }).access = {
      kind: "writable",
      freshness: "live",
    };
    (rendered.list as XList).id = ACTIVE_LIST.id;
    (rendered.list as XList).name = "Forged active List";

    expect(picker.act({ type: "choose", rowKey: rendered.key })).toBeNull();
  });

  it("chooses the private List snapshot when an active render row is tampered", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
    });
    await picker.open([{ screenName: "jane" }]);
    const rendered = picker.view.value.flat[0]!;
    (rendered.list as XList).id = "FORGED";
    (rendered.list as XList).name = "Forged";

    expect(picker.act({ type: "choose", rowKey: rendered.key })).toMatchObject({
      type: "chosen",
      owner: ACTIVE,
      list: ACTIVE_LIST,
    });
  });

  it("accepts one choose per open and stops observing immediately", async () => {
    const dispose = vi.fn();
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe() {
          return dispose;
        },
      }),
    });
    await picker.open([{ screenName: "jane" }]);

    expect(picker.act({ type: "choose", rowKey: "1:100:A1" })).toEqual({
      type: "chosen",
      owner: ACTIVE,
      list: ACTIVE_LIST,
      authors: [{ screenName: "jane" }],
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(picker.act({ type: "choose", rowKey: "1:100:A1" })).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("keeps observing after inert foreign and missing choices", async () => {
    const dispose = vi.fn();
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [{ owner: FOREIGN, lists: [FOREIGN_LIST] }],
            memberships: [],
          });
          return dispose;
        },
      }),
    });
    await picker.open([{ screenName: "jane" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });

    expect(picker.act({ type: "choose", rowKey: "1:200:F1" })).toBeNull();
    expect(picker.act({ type: "choose", rowKey: "missing" })).toBeNull();
    expect(dispose).not.toHaveBeenCalled();
    expect(picker.act({ type: "choose", rowKey: "1:100:A1" })?.type).toBe("chosen");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("finishes the active refresh and Reconcile after a choose", async () => {
    let release!: (lists: XList[]) => void;
    let currentTime = 123;
    const fresh = new Promise<XList[]>((resolve) => {
      release = resolve;
    });
    const replaceCatalog = vi.fn(async (_owner: Owner, _snapshot: CompleteCatalogSnapshot) => {});
    const picker = createPickerController({
      cache: { cached: async () => [ACTIVE_LIST], refresh: async () => fresh },
      currentOwner: () => ACTIVE,
      membershipStore: mirror({ observe: () => () => {}, replaceCatalog }),
      now: () => currentTime,
    });
    const opening = picker.open([{ screenName: "jane" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(picker.act({ type: "choose", rowKey: "1:100:A1" })?.type).toBe("chosen");
    currentTime = 456;
    release([ACTIVE_LIST]);
    await opening;
    expect(replaceCatalog).toHaveBeenCalledWith(ACTIVE, {
      lists: [ACTIVE_LIST],
      observedAt: 123,
      ownerObservedAt: 123,
    });
  });

  it("reopens for a new Owner when deferred membership settles", async () => {
    let owner = ACTIVE;
    let releaseRefresh!: (lists: XList[]) => void;
    let releaseMembership!: (ids: string[]) => void;
    const firstRefresh = new Promise<XList[]>((resolve) => {
      releaseRefresh = resolve;
    });
    const firstMembership = new Promise<string[]>((resolve) => {
      releaseMembership = resolve;
    });
    let refreshes = 0;
    let membershipReads = 0;
    const replaceCatalog = vi.fn(async (_owner: Owner, _snapshot: CompleteCatalogSnapshot) => {});
    const reconcileAuthor = vi.fn(
      async (_owner: Owner, _person: MembershipPerson, _snapshot: ObservedMembershipSnapshot) => {},
    );
    const picker = createPickerController({
      cache: {
        cached: async (candidate) => (candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : null),
        refresh: async () => (++refreshes === 1 ? firstRefresh : [FOREIGN_LIST]),
      },
      currentOwner: () => owner,
      membershipStore: mirror({
        observe: () => () => {},
        replaceCatalog,
        reconcileAuthor,
      }),
      memberships: async () => (++membershipReads === 1 ? firstMembership : []),
    });
    const opening = picker.open([{ screenName: "jane", userId: "7" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    owner = FOREIGN;
    releaseMembership([ACTIVE_LIST.id]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
    expect(picker.view.value.flat[0]?.access.kind).toBe("writable");

    releaseRefresh([ACTIVE_LIST]);
    await opening;
    expect(replaceCatalog.mock.calls.map(([candidate]) => candidate.userId)).toEqual(["200"]);
    expect(reconcileAuthor.mock.calls.map(([candidate]) => candidate.userId)).toEqual(["200"]);
  });

  it("does not publish or Reconcile a deferred refresh for an old Owner", async () => {
    let owner = ACTIVE;
    let releaseActive!: (lists: XList[]) => void;
    let releaseForeign!: (lists: XList[]) => void;
    const activeRefresh = new Promise<XList[]>((resolve) => {
      releaseActive = resolve;
    });
    const foreignRefresh = new Promise<XList[]>((resolve) => {
      releaseForeign = resolve;
    });
    let refreshes = 0;
    const replaceCatalog = vi.fn(async (_owner: Owner, _snapshot: CompleteCatalogSnapshot) => {});
    const picker = createPickerController({
      cache: {
        cached: async (candidate) => (candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : null),
        refresh: async () => (++refreshes === 1 ? activeRefresh : foreignRefresh),
      },
      currentOwner: () => owner,
      membershipStore: mirror({ observe: () => () => {}, replaceCatalog }),
      memberships: async () => [],
    });
    const opening = picker.open([{ screenName: "jane" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    owner = FOREIGN;
    releaseActive([{ id: "STALE", name: "Stale" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(picker.view.value.flat).toEqual([]);
    expect(picker.view.value.status).toBe("loading");
    expect(replaceCatalog).not.toHaveBeenCalled();

    releaseForeign([FOREIGN_LIST]);
    await opening;
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
    expect(replaceCatalog.mock.calls.map(([candidate]) => candidate.userId)).toEqual(["200"]);
  });

  it("resets choice consumption on retry", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
    });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.act({ type: "choose", rowKey: "1:100:A1" })?.type).toBe("chosen");

    picker.act({ type: "retry" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker.act({ type: "choose", rowKey: "2:100:A1" })?.type).toBe("chosen");
  });

  it("makes close terminal and disposes an observation once", async () => {
    const dispose = vi.fn();
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({ observe: () => dispose }),
    });
    await picker.open([{ screenName: "jane" }]);
    const rowKey = picker.view.value.flat[0]!.key;
    const stopView = picker.view.subscribe(() => {});

    picker.act({ type: "close" });
    picker.act({ type: "close" });
    expect(dispose).toHaveBeenCalledOnce();
    expect(picker.act({ type: "choose", rowKey })).toBeNull();
    stopView();
  });

  it("swallows a broken Mirror disposer on every terminal path", async () => {
    const dispose = vi.fn(() => {
      throw new Error("broken disposer");
    });
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({ observe: () => dispose }),
    });
    await picker.open([{ screenName: "jane" }]);

    expect(() => picker.act({ type: "choose", rowKey: "1:100:A1" })).not.toThrow();
    await expect(picker.open([{ screenName: "jane" }])).resolves.toBeUndefined();
    expect(() => picker.act({ type: "close" })).not.toThrow();
  });

  it("reopens the captured Selection on the first stale choose", async () => {
    let owner = ACTIVE;
    const picker = createPickerController({
      cache: {
        cached: async (candidate) =>
          candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : [FOREIGN_LIST],
        refresh: async (candidate) =>
          candidate?.userId === ACTIVE.userId ? [ACTIVE_LIST] : [FOREIGN_LIST],
      },
      currentOwner: () => owner,
      membershipStore: mirror(),
    });
    await picker.open([{ screenName: "jane" }]);
    const staleKey = picker.view.value.flat[0]!.key;
    owner = FOREIGN;

    expect(picker.act({ type: "choose", rowKey: staleKey })).toBeNull();
    expect(picker.view.value.flat).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["2:200:F1"]);
    expect(picker.view.value.authors).toEqual([{ screenName: "jane" }]);
    expect(picker.act({ type: "choose", rowKey: staleKey })).toBeNull();
    expect(picker.act({ type: "choose", rowKey: "2:200:F1" })).toMatchObject({
      type: "chosen",
      owner: FOREIGN,
      list: FOREIGN_LIST,
      authors: [{ screenName: "jane" }],
    });
  });

  it("lets active X replace stale active-Owner Mirror rows", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [
              {
                owner: ACTIVE,
                lists: [{ id: "OLD", name: "Deleted" }],
                lastReconciledAt: 1,
              },
              { owner: FOREIGN, lists: [FOREIGN_LIST], lastReconciledAt: 2 },
            ],
            memberships: [],
          });
          return () => {};
        },
      }),
    });

    await picker.open([{ screenName: "jane" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:100:A1", "1:200:F1"]);
  });

  it("keeps Mirror failure off the X path", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe() {
          throw new Error("offline");
        },
      }),
    });

    await expect(picker.open([{ screenName: "jane" }])).resolves.toBeUndefined();
    expect(picker.view.value.status).toBe("ready");
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:100:A1"]);
  });

  it("does not let a foreign Mirror catalog hide an active X failure", async () => {
    const picker = createPickerController({
      cache: {
        cached: async () => null,
        refresh: async () => {
          throw new Error("X offline");
        },
      },
      currentOwner: () => ACTIVE,
      membershipStore: mirror(),
    });

    await picker.open([{ screenName: "jane" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });
    expect(picker.view.value.flat.map((row) => row.key)).toEqual(["1:200:F1"]);
    expect(picker.view.value.status).toBe("error");
  });

  it("keeps a synchronously failing subscription off the X path", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe() {
          throw new Error("socket blocked");
        },
      }),
    });
    await picker.open([{ screenName: "jane" }]);
    expect(picker.view.value.status).toBe("ready");
  });

  it("starts catalog before membership and Reconciles catalog first", async () => {
    const calls: string[] = [];
    const starts: string[] = [];
    const startTimes = [122, 123, 124];
    let currentTime = 123;
    let releaseMembership!: (ids: string[]) => void;
    const membership = new Promise<string[]>((resolve) => {
      releaseMembership = resolve;
    });
    const store = mirror({
      async replaceCatalog(owner, snapshot) {
        calls.push(
          `catalog:${owner.userId}:${snapshot.ownerObservedAt}:${snapshot.observedAt}:${snapshot.lists
            .map((list) => list.id)
            .join(",")}`,
        );
      },
      async reconcileAuthor(owner, person, snapshot) {
        calls.push(
          `author:${owner.userId}:${person.screenName}:${person.identity}:${snapshot.ownerObservedAt}:${snapshot.observedAt}:${snapshot.listIds.join(",")}`,
        );
      },
    });
    const picker = createPickerController({
      cache: {
        cached: async () => null,
        refresh: async () => {
          starts.push("catalog");
          return [ACTIVE_LIST];
        },
      },
      currentOwner: () => ACTIVE,
      membershipStore: store,
      memberships: async () => {
        starts.push("membership");
        return membership;
      },
      now: () => startTimes.shift() ?? currentTime,
    });

    const opening = picker.open([{ screenName: "jane", userId: "7" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentTime = 456;
    releaseMembership([ACTIVE_LIST.id]);
    await opening;

    expect(picker.view.value.flat[0]?.membership).toEqual({
      kind: "present",
      source: "x-live",
    });
    expect(starts).toEqual(["catalog", "membership"]);
    expect(calls).toEqual(["catalog:100:122:123:A1", "author:100:jane:user:7:122:124:A1"]);
  });

  it("persists a fresh catalog before optional enhancements settle", async () => {
    const replaceCatalog = vi.fn(async () => {});
    const never = new Promise<never>(() => {});
    const picker = createPickerController({
      cache: cache(null, [ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({ replaceCatalog }),
      memberships: async () => never,
      recentIds: async () => never,
      now: () => 123,
    });

    void picker.open([{ screenName: "jane", userId: "7" }]);

    await vi.waitFor(() => expect(replaceCatalog).toHaveBeenCalledOnce());
    expect(picker.view.value.status).toBe("ready");
    picker.act({ type: "close" });
  });

  it("reconciles the Author even when catalog reconcile fails", async () => {
    const calls: string[] = [];
    const picker = createPickerController({
      cache: cache(null, [ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        async replaceCatalog() {
          calls.push("catalog");
          throw new Error("catalog failed");
        },
        async reconcileAuthor() {
          calls.push("author");
        },
      }),
      memberships: async () => [ACTIVE_LIST.id],
    });

    await picker.open([{ screenName: "jane", userId: "7" }]);
    expect(calls).toEqual(["catalog", "author"]);
  });

  it("keeps dated foreign membership when active X membership fails", async () => {
    const reconcileAuthor = vi.fn(async () => {});
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        reconcileAuthor,
        observe(_subject, emit) {
          emit({
            catalog: [{ owner: FOREIGN, lists: [FOREIGN_LIST], lastReconciledAt: 123 }],
            memberships: [
              {
                ownerUserId: FOREIGN.userId,
                listId: FOREIGN_LIST.id,
                present: true,
                lastSeenAt: 456,
              },
            ],
          });
          return () => {};
        },
      }),
      memberships: async () => {
        throw new Error("X failed");
      },
    });

    await picker.open([{ screenName: "jane", tweetId: "post-1" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });

    expect(picker.view.value.flat.find((row) => row.key === "1:100:A1")?.membership).toEqual({
      kind: "unknown",
    });
    expect(picker.view.value.flat.find((row) => row.key === "1:200:F1")?.membership).toEqual({
      kind: "present",
      source: "mirror-cached",
      asOf: 456,
    });
    expect(reconcileAuthor).not.toHaveBeenCalled();
  });

  it("keeps Mirror membership unknown and skips its snapshot when identity is absent", async () => {
    const subjects: unknown[] = [];
    const reconcileAuthor = vi.fn(async () => {});
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        reconcileAuthor,
        observe(subject, emit) {
          subjects.push(subject);
          emit({
            catalog: [{ owner: FOREIGN, lists: [FOREIGN_LIST] }],
            memberships: [
              {
                ownerUserId: FOREIGN.userId,
                listId: FOREIGN_LIST.id,
                present: true,
                lastSeenAt: 456,
              },
            ],
          });
          return () => {};
        },
      }),
      memberships: async () => null,
    });

    await picker.open([{ screenName: "display-only" }]);
    picker.act({ type: "select-scope", scope: { kind: "all" } });

    expect(subjects).toEqual([{ kind: "bulk" }]);
    expect(picker.view.value.flat.find((row) => row.key === "1:200:F1")?.membership).toEqual({
      kind: "unknown",
    });
    expect(reconcileAuthor).not.toHaveBeenCalled();
  });

  it("keeps active membership unknown when X fails despite a Mirror hit", async () => {
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({
        observe(_subject, emit) {
          emit({
            catalog: [],
            memberships: [
              {
                ownerUserId: ACTIVE.userId,
                listId: ACTIVE_LIST.id,
                present: true,
                lastSeenAt: 456,
              },
            ],
          });
          return () => {};
        },
      }),
      memberships: async () => {
        throw new Error("X failed");
      },
    });

    await picker.open([{ screenName: "jane" }]);
    expect(picker.view.value.flat[0]?.membership).toEqual({ kind: "unknown" });
  });

  it("keeps active membership unknown and skips Mirror reconciliation when X returns null", async () => {
    const reconcileAuthor = vi.fn(async () => {});
    const picker = createPickerController({
      cache: cache([ACTIVE_LIST]),
      currentOwner: () => ACTIVE,
      membershipStore: mirror({ reconcileAuthor, observe: () => () => {} }),
      memberships: async () => null,
    });

    await picker.open([{ screenName: "jane" }]);

    expect(picker.view.value.flat[0]?.membership).toEqual({ kind: "unknown" });
    expect(reconcileAuthor).not.toHaveBeenCalled();
  });
});
