import { describe, expect, it, vi } from "vitest";

import { createAppState } from "@/content/app-state";
import type { CollectionsClient, SavedByGesture } from "@/content/collections-client";
import { createLassoController, UNDO_WINDOW_MS } from "@/content/controller";
import { createCoach } from "@/core/coach";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import type { DefaultSaveOutcome } from "@/core/protocol/collections";
import { createSelectionStore, type TweetAuthor } from "@/core/selection-store";
import { createSettings } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import { createUndoRegistry } from "@/core/undo";
import type { MembershipChange, MembershipStore, Owner } from "@/packages/membership-store/types";
import {
  XApiError,
  type MutationEvidence,
  type XList,
  type XListApi,
} from "@/packages/x-client/types";

const LISTS: XList[] = [
  { id: "L1", name: "Design Folks" },
  { id: "L2", name: "Founders" },
];
const OWNER: Owner = { userId: "100", screenName: "me" };

class FakeApi implements XListApi {
  readonly evidence: MutationEvidence;
  added: string[] = [];
  removed: string[] = [];
  addImpl: (author: TweetAuthor) => Promise<void> = async () => {};
  constructor(evidence: MutationEvidence = "server-response") {
    this.evidence = evidence;
  }
  async addMember(_list: XList, author: TweetAuthor): Promise<void> {
    this.added.push(author.screenName);
    return this.addImpl(author);
  }
  async removeMember(_list: XList, author: TweetAuthor): Promise<void> {
    this.removed.push(author.screenName);
  }
}

function fakeCache(lists: XList[]): ListCache {
  return {
    async cached() {
      return lists;
    },
    async refresh() {
      return lists;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(
  opts: {
    targetAuthor?: TweetAuthor | null;
    targetTweet?: Element | null;
    lists?: XList[];
    membershipStore?: MembershipStore;
    pickerMembershipStore?: MembershipStore;
    currentOwner?: () => Owner | null;
    block?: (s: string) => Promise<void>;
    withBlock?: boolean;
    anchorFor?: (tweetEl: Element) => { left: number; top: number } | null;
    omitNow?: boolean;
    omitCurrentOwner?: boolean;
    settings?: import("@/core/settings").SettingsStore;
    usage?: { record: (ownerUserId: string, listId: string) => Promise<void> };
    filter?: FilterStore;
    filterInScope?: () => boolean;
    mirrorConfigurationId?: () => string | null;
    onMirrorResult?: (result: { ok: boolean; configId: string }) => void;
    now?: () => number;
    evidence?: MutationEvidence;
    backendSource?: { snapshot(): XListApi };
    collections?: CollectionsClient;
  } = {},
) {
  const selection = createSelectionStore();
  const app = createAppState(selection);
  const backend = new FakeApi(opts.evidence);
  const cache = fakeCache(opts.lists ?? LISTS);
  const currentOwner = opts.currentOwner ?? (() => OWNER);
  const picker = createPickerController({
    cache,
    currentOwner,
    membershipStore: opts.pickerMembershipStore,
  });
  const toasts = createToastStore({ setTimer: () => 1, clearTimer: () => {} });
  const undo = createUndoRegistry({ setTimer: () => 1, clearTimer: () => {} });
  const coach = createCoach(memoryArea());
  const settings = opts.settings ?? createSettings(memoryArea());
  const quick = {
    mute: vi.fn(async (_s: string) => {}),
    unmute: vi.fn(async (_s: string) => {}),
    notInterested: vi.fn(async (_el: Element): Promise<"hidden" | "unavailable"> => "hidden"),
    ...(opts.withBlock || opts.block
      ? {
          block: opts.block ? vi.fn(opts.block) : vi.fn(async (_s: string) => {}),
        }
      : {}),
  };
  const openUrl = vi.fn();
  const defaultTweet = document.createElement("article");
  const target = {
    author: () => (opts.targetAuthor === undefined ? { screenName: "jane" } : opts.targetAuthor),
    tweet: () => (opts.targetTweet === undefined ? defaultTweet : opts.targetTweet),
  };
  const controller = createLassoController({
    selection,
    app,
    picker,
    toasts,
    undo,
    coach,
    backend: opts.backendSource ?? { snapshot: () => backend },
    cache,
    settings,
    quick,
    target,
    ...(opts.collections ? { collections: opts.collections } : {}),
    openUrl,
    membershipStore: opts.membershipStore,
    ...(opts.omitCurrentOwner ? {} : { currentOwner }),
    mirrorConfigurationId: opts.mirrorConfigurationId,
    onMirrorResult: opts.onMirrorResult,
    anchorFor: opts.anchorFor,
    usage: opts.usage as Parameters<typeof createLassoController>[0]["usage"],
    filter: opts.filter,
    filterInScope: opts.filterInScope,
    assignOpts: { sleep: async () => {}, delayMs: 0 },
    ...(opts.omitNow ? {} : { now: opts.now ?? (() => Date.UTC(2026, 5, 10)) }),
  });
  const assign = (list: XList, owner: Owner | null = currentOwner()) => {
    return controller.pickerEffect({
      type: "chosen",
      owner,
      list,
      authors: selection.list(),
    });
  };
  return {
    selection,
    app,
    backend,
    cache,
    picker,
    toasts,
    undo,
    coach,
    settings,
    quick,
    openUrl,
    defaultTweet,
    controller,
    assign,
  };
}

function memoryArea() {
  const store: Record<string, unknown> = {};
  return {
    async get() {
      return { ...store };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
  };
}

const titles = (h: { toasts: { toasts: { value: Array<{ title: string }> } } }) =>
  h.toasts.toasts.value.map((t) => t.title);

describe("Alt+L — file the author under the cursor", () => {
  it("selects the hovered author and opens the picker", async () => {
    const h = harness();
    expect(h.controller.command("add-to-list")).toBe(true);
    await flush();
    expect(h.selection.isSelected("jane")).toBe(true);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.picker.view.value.status).toBe("ready");
  });

  it("with no target shows the nudge toast instead of console noise", () => {
    const h = harness({ targetAuthor: null });
    h.controller.command("add-to-list");
    expect(titles(h)).toEqual(["Hover a post first — or press j to focus one"]);
  });
});

describe("the assign run (story beats 4 & 7)", () => {
  it("uses the null-Owner default when the wire omits Owner discovery", async () => {
    const h = harness({ omitCurrentOwner: true });
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0]!, null);

    expect(h.backend.added).toEqual(["a"]);
  });

  it("allows an unknown-owner target only while no Owner is logged in", async () => {
    const h = harness({ currentOwner: () => null });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!, null);
    expect(h.backend.added).toEqual(["a"]);
  });

  it("requires a current matching Owner for an Owner-bound assign", async () => {
    const h = harness({ currentOwner: () => null });
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0]!, OWNER);

    expect(h.backend.added).toEqual([]);
  });

  it("blocks an unknown-owner target after an Owner appears", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0]!, null);

    expect(h.backend.added).toEqual([]);
  });

  it("blocks an account switch between choose and assign", async () => {
    let owner = OWNER;
    const h = harness({ currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    owner = { userId: "200", screenName: "other" };

    await h.controller.pickerEffect({
      type: "chosen",
      owner: OWNER,
      list: LISTS[0]!,
      authors: [{ screenName: "a" }],
    });

    expect(h.backend.added).toEqual([]);
    expect(h.selection.isSelected("a")).toBe(true);
  });

  it("blocks X, usage, and Mirror after an Owner switch", async () => {
    let owner = OWNER;
    const { store, calls } = recordingStore();
    const usage = { record: vi.fn(async () => {}) };
    const h = harness({
      currentOwner: () => owner,
      membershipStore: store,
      usage,
    });
    h.selection.add({ screenName: "a" });
    owner = { userId: "200", screenName: "other" };

    await h.assign(LISTS[0]!, OWNER);
    await flush();

    expect(h.backend.added).toEqual([]);
    expect(usage.record).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("happy path: progress, success toast with View List + Undo, selection cleared", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    expect(h.backend.added).toEqual(["a", "b"]);
    expect(h.selection.count.value).toBe(0);
    expect(h.app.running.value).toBeNull();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe("Added 2 to Design Folks");
    expect(toast?.actions?.map((a) => a.label)).toEqual(["View List", "Undo"]);
  });

  it("pins a paced run to its starting backend, then uses the new backend next time", async () => {
    const oldApi = new FakeApi();
    const newApi = new FakeApi();
    let current: XListApi = oldApi;
    const first = deferred<void>();
    oldApi.addImpl = (author) => (author.screenName === "a" ? first.promise : Promise.resolve());
    const h = harness({ backendSource: { snapshot: () => current } });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });

    const run = h.assign(LISTS[0]!);
    await flush();
    current = newApi;
    first.resolve();
    await run;

    expect(oldApi.added).toEqual(["a", "b"]);
    expect(newApi.added).toEqual([]);

    h.selection.add({ screenName: "c" });
    await h.assign(LISTS[0]!);
    expect(newApi.added).toEqual(["c"]);
  });

  it("uses the originating backend for Undo after a switch", async () => {
    const oldApi = new FakeApi();
    const newApi = new FakeApi();
    let current: XListApi = oldApi;
    const h = harness({ backendSource: { snapshot: () => current } });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!);
    current = newApi;

    expect(h.controller.command("undo")).toBe(true);
    await flush();

    expect(oldApi.removed).toEqual(["a"]);
    expect(newApi.removed).toEqual([]);
  });

  it("View List opens the List on X", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    const id = h.toasts.toasts.value[0]?.id as number;
    h.toasts.act(id, 0);
    expect(h.openUrl).toHaveBeenCalledWith("https://x.com/i/lists/L1");
  });

  it("Z undoes only what was just added, then confirms", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    expect(h.toasts.toasts.value[0]?.durationMs).toBe(UNDO_WINDOW_MS);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a", "b"]);
    expect(titles(h)).toContain("Removed 2 from Design Folks");
  });

  it("blocks Undo after an account switch", async () => {
    let owner = OWNER;
    const h = harness({ currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!);
    owner = { userId: "200", screenName: "other" };
    h.controller.command("undo");
    await flush();
    expect(h.backend.removed).toEqual([]);
  });

  it("blocks Undo when the Owner is no longer known", async () => {
    let owner: Owner | null = OWNER;
    const h = harness({ currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!);
    owner = null;

    h.controller.command("undo");
    await flush();

    expect(h.backend.removed).toEqual([]);
  });

  it("stops Undo after the Owner changes during its first removal", async () => {
    let owner: Owner | null = OWNER;
    const h = harness({ currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0]!);
    h.backend.removeMember = async (_list, author) => {
      h.backend.removed.push(author.screenName);
      owner = { userId: "200", screenName: "other" };
    };

    h.controller.command("undo");
    await flush();

    expect(h.backend.removed).toEqual(["a"]);
    expect(titles(h)).toContain("Removed 1 from Design Folks");
  });

  it("z with nothing armed is left for X", () => {
    const h = harness();
    expect(h.controller.command("undo")).toBe(false);
  });

  it("rate limit mid-run: persistent danger toast, remaining people stay selected", async () => {
    const h = harness();
    h.backend.addImpl = async (au) => {
      if (au.screenName === "c") {
        throw new XApiError("rate-limited", "429", {
          resetAt: Date.UTC(2026, 5, 10) / 1000 + 720,
        });
      }
    };
    for (const s of ["a", "b", "c", "d", "e"]) h.selection.add({ screenName: s });
    await h.assign(LISTS[0] as XList);
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe("X rate limit reached");
    expect(toast?.line).toBe("Added 2 · 3 still selected — try again in 12 min");
    expect(toast?.durationMs).toBeNull();
    expect(h.selection.count.value).toBe(3); // c, d, e remain
  });

  it("Stop aborts the rest and reports the split", async () => {
    const h = harness();
    h.backend.addImpl = async (au) => {
      if (au.screenName === "b") h.controller.stopRun(); // user clicks Stop mid-flight
    };
    for (const s of ["a", "b", "c", "d", "e", "f", "g"]) h.selection.add({ screenName: s });
    await h.assign(LISTS[0] as XList);
    expect(titles(h)).toContain("2 added · 5 still selected");
    expect(h.selection.count.value).toBe(5);
  });

  it("consumes Escape during an assignment without stopping or changing its state", async () => {
    const firstAdd = deferred<void>();
    const firstStarted = deferred<void>();
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    h.backend.addImpl = async (author) => {
      if (author.screenName === "a") {
        firstStarted.resolve();
        await firstAdd.promise;
      }
    };

    const run = h.assign(LISTS[0]!);
    await firstStarted.promise;
    const progress = h.app.running.value;

    const consumed = h.controller.command("escape");
    const selectionAfterEscape = h.selection.list();
    const progressAfterEscape = h.app.running.value;

    h.controller.stopRun();
    firstAdd.resolve();
    await run;

    expect(consumed).toBe(true);
    expect(selectionAfterEscape).toEqual([{ screenName: "a" }, { screenName: "b" }]);
    expect(progressAfterEscape).toBe(progress);
    expect(h.backend.added).toEqual(["a"]);
    expect(h.selection.list()).toEqual([{ screenName: "b" }]);
    expect(h.app.running.value).toBeNull();
  });

  it("locks public selection toggles until the assignment releases", async () => {
    const firstAdd = deferred<void>();
    const firstStarted = deferred<void>();
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    h.backend.addImpl = async (author) => {
      if (author.screenName === "a") {
        firstStarted.resolve();
        await firstAdd.promise;
      }
    };

    const run = h.assign(LISTS[0]!);
    await firstStarted.promise;

    h.controller.toggleSelect({ screenName: "a" });
    h.controller.toggleSelect({ screenName: "c" });
    const selectionWhileRunning = h.selection.list();

    h.controller.stopRun();
    firstAdd.resolve();
    await run;

    h.controller.toggleSelect({ screenName: "b" });
    h.controller.toggleSelect({ screenName: "c" });

    expect(selectionWhileRunning).toEqual([{ screenName: "a" }, { screenName: "b" }]);
    expect(h.selection.list()).toEqual([{ screenName: "c" }]);
  });

  it("toast Undo cannot start while another assignment is active", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!);
    const staleToast = h.toasts.toasts.value[0];
    expect(staleToast?.actions?.some((action) => action.label === "Undo")).toBe(true);

    const pendingAdd = deferred<void>();
    const addStarted = deferred<void>();
    h.selection.add({ screenName: "b" });
    h.backend.addImpl = async (author) => {
      if (author.screenName === "b") {
        addStarted.resolve();
        await pendingAdd.promise;
      }
    };
    const run = h.assign(LISTS[0]!);
    await addStarted.promise;

    staleToast?.actions?.find((action) => action.label === "Undo")?.run();
    await flush();
    expect(h.backend.removed).toEqual([]);

    h.controller.stopRun();
    pendingAdd.resolve();
    await run;
    expect(h.backend.removed).toEqual([]);
  });

  it("serializes a picker run against a concurrent default-list command", async () => {
    const firstAdd = deferred<void>();
    const firstStarted = deferred<void>();
    const h = harness();
    await h.settings.set({
      defaultList: { ownerUserId: OWNER.userId, listId: "L1" },
    });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    h.backend.addImpl = async (author) => {
      if (author.screenName === "a") {
        firstStarted.resolve();
        await firstAdd.promise;
      }
    };

    const pickerRun = h.assign(LISTS[0]!);
    await firstStarted.promise;
    const progress = h.app.running.value;
    expect(progress).toEqual({ current: 1, total: 2, listName: "Design Folks" });

    const oldUndo = vi.fn();
    h.undo.arm(oldUndo, UNDO_WINDOW_MS);
    expect(h.controller.command("help")).toBe(true); // existing modal grammar remains live
    expect(h.app.shortcutsOpen.value).toBe(true);
    expect(h.controller.command("escape")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(false);
    expect(h.controller.command("add-to-list")).toBe(true);
    expect(h.controller.command("add-to-default-list")).toBe(true);
    await h.controller.pickerEffect({
      type: "chosen",
      owner: OWNER,
      list: LISTS[1]!,
      authors: [{ screenName: "second" }],
    });
    expect(h.controller.command("undo")).toBe(true);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(h.app.running.value).toBe(progress);
    expect(h.app.pickerOpen.value).toBe(false);
    expect(oldUndo).not.toHaveBeenCalled();

    h.controller.stopRun(); // the visible Stop button still owns cancellation
    firstAdd.resolve();
    await pickerRun;

    expect(h.backend.added).toEqual(["a"]);
    expect(h.app.running.value).toBeNull();
    expect(h.selection.list()).toEqual([{ screenName: "b" }]);
    expect(titles(h)).toContain("1 added · 1 still selected");
  });

  it("Owner loss mid-run stops cleanly without a Mirror write", async () => {
    let owner = OWNER;
    const { store, calls } = recordingStore();
    const h = harness({ currentOwner: () => owner, membershipStore: store });
    h.backend.addImpl = async (author) => {
      if (author.screenName === "a") owner = { userId: "200", screenName: "other" };
    };
    for (const screenName of ["a", "b", "c"]) h.selection.add({ screenName });

    await h.assign(LISTS[0]!);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(h.selection.isSelected("a")).toBe(false);
    expect(h.selection.count.value).toBe(2);
    expect(h.toasts.toasts.value[0]).toMatchObject({
      kind: "info",
      title: "1 added · 2 still selected",
      actions: [],
    });
    expect(calls).toEqual([]);
  });

  it("latches a brief Owner switch for the whole run", async () => {
    let firstMismatch = true;
    let firstAdded = false;
    const { store, calls } = recordingStore();
    const h = harness({
      currentOwner: () => {
        if (!firstAdded) return OWNER;
        if (firstMismatch) {
          firstMismatch = false;
          return { userId: "200", screenName: "other" };
        }
        return OWNER;
      },
      membershipStore: store,
    });
    h.backend.addImpl = async () => {
      firstAdded = true;
    };
    for (const screenName of ["a", "b"]) h.selection.add({ screenName });

    await h.assign(LISTS[0]!);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(h.toasts.toasts.value[0]).toMatchObject({
      kind: "info",
      title: "1 added · 1 still selected",
      actions: [],
    });
    expect(calls).toEqual([]);
  });

  it("Retry re-runs with the people who stayed selected", async () => {
    const h = harness();
    h.backend.addImpl = async (au) => {
      if (au.screenName === "bad" && h.backend.added.filter((s) => s === "bad").length === 1) {
        throw new XApiError("unknown", "HTTP 500");
      }
    };
    h.selection.add({ screenName: "ok" });
    h.selection.add({ screenName: "bad" });
    await h.assign(LISTS[0] as XList);
    expect(h.selection.isSelected("bad")).toBe(true);
    const danger = h.toasts.toasts.value.find((t) => t.kind === "danger");
    const retry = danger?.actions?.find((a) => a.label === "Retry");
    retry?.run();
    h.toasts.dismiss(danger?.id as number);
    await flush();
    expect(h.backend.added).toEqual(["ok", "bad", "bad"]);
  });

  it("blocks Retry when its Owner is no longer known", async () => {
    let owner: Owner | null = OWNER;
    const h = harness({ currentOwner: () => owner });
    h.backend.addImpl = async () => {
      throw new XApiError("unknown", "HTTP 500");
    };
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0]!);
    owner = null;

    const retry = h.toasts.toasts.value.find((toast) => toast.kind === "danger")?.actions?.[0];
    retry?.run();
    await flush();

    expect(h.backend.added).toEqual(["a"]);
  });

  it("keeps X successful when usage recording throws or rejects", async () => {
    for (const record of [
      (() => {
        throw new Error("sync usage failure");
      }) as unknown as (ownerUserId: string, listId: string) => Promise<void>,
      async () => Promise.reject(new Error("async usage failure")),
    ]) {
      const h = harness({ usage: { record } });
      h.selection.add({ screenName: "a" });

      await h.assign(LISTS[0]!);
      await flush();

      expect(h.backend.added).toEqual(["a"]);
      expect(titles(h)).toContain("Added 1 to Design Folks");
    }
  });
});

describe("Alt+Shift+L — the graduation chord (story beat 6)", () => {
  it("adds the hovered author straight to the default List, no picker", async () => {
    const h = harness();
    await h.settings.set({
      defaultList: { ownerUserId: OWNER.userId, listId: "L1" },
    });
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual(["jane"]);
    expect(h.app.pickerOpen.value).toBe(false);
    expect(titles(h)).toContain("Added 1 to Design Folks");
  });

  it("falls back to the picker when no default List is set", async () => {
    const h = harness();
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("falls back to the keyboard Picker when the default-list settings read rejects", async () => {
    const base = createSettings(memoryArea());
    const get = vi.fn(async () => Promise.reject(new Error("storage offline")));
    const h = harness({ settings: { ...base, get } });

    expect(h.controller.command("add-to-default-list")).toBe(true);
    await flush();

    expect(get).toHaveBeenCalledOnce();
    expect(h.backend.added).toEqual([]);
    expect(h.selection.list()).toEqual([{ screenName: "jane" }]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.picker.view.value.status).toBe("ready");
  });
});

describe("quick actions report back (story beat 6)", () => {
  it("mute: past-tense toast with Undo; Z unmutes", async () => {
    const h = harness();
    h.controller.command("mute");
    await flush();
    expect(h.quick.mute).toHaveBeenCalledWith("jane");
    expect(titles(h)).toEqual(["Muted @jane"]);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.quick.unmute).toHaveBeenCalledWith("jane");
  });

  it("mute failure: literal danger toast with Retry", async () => {
    const h = harness();
    h.quick.mute.mockRejectedValueOnce(new Error("boom"));
    h.controller.command("mute");
    await flush();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.kind).toBe("danger");
    expect(toast?.title).toBe("Couldn't mute @jane");
    expect(toast?.actions?.[0]?.label).toBe("Retry");
  });

  it("not-interested confirms that X received the feedback", async () => {
    const h = harness();
    h.controller.command("not-interested");
    await flush();
    expect(titles(h)).toEqual(["Hidden — told X you're not interested"]);
  });

  it("not-interested stays fully silent where X offers no 'not interested'", async () => {
    const h = harness();
    h.quick.notInterested.mockResolvedValueOnce("unavailable");
    h.controller.command("not-interested");
    await flush();
    expect(titles(h)).toEqual([]); // no success, no failure, no Retry
  });
});

describe("escape / help / selection coaching", () => {
  it("escape is consumed only when Lasso has something open", () => {
    const h = harness();
    expect(h.controller.command("escape")).toBe(false);
    h.app.pickerOpen.value = true;
    expect(h.controller.command("escape")).toBe(true);
    expect(h.app.pickerOpen.value).toBe(false);
  });

  it("global Escape closes the Picker model before its UI", async () => {
    const dispose = vi.fn();
    const pickerMembershipStore: MembershipStore = {
      recordAssign: async () => {},
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => dispose,
    };
    const h = harness({ pickerMembershipStore });
    h.controller.openPicker();
    await flush();

    expect(h.controller.command("escape")).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.app.pickerOpen.value).toBe(false);
  });

  it("assigns the Picker's captured authors after live selection drifts", async () => {
    const h = harness();
    h.selection.add({ screenName: "opened" });
    const effect = {
      type: "chosen" as const,
      owner: OWNER,
      list: LISTS[0]!,
      authors: [{ screenName: "opened" }],
    };
    h.selection.clear();
    h.selection.add({ screenName: "later" });

    await h.controller.pickerEffect(effect);

    expect(h.backend.added).toEqual(["opened"]);
    expect(h.selection.isSelected("later")).toBe(true);
  });

  it("? toggles the shortcuts sheet", () => {
    const h = harness();
    expect(h.controller.command("help")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(true);
    h.controller.command("help");
    expect(h.app.shortcutsOpen.value).toBe(false);
  });

  it("? never opens Shortcuts over Welcome, but closes an open sheet", () => {
    const h = harness();
    h.app.welcomeOpen.value = true;

    expect(h.controller.command("help")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(false);

    h.app.shortcutsOpen.value = true;
    expect(h.controller.command("help")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(false);
  });

  it.each(["welcomeOpen", "shortcutsOpen"] as const)(
    "%s consumes Lasso commands without changing the page behind it",
    (modal) => {
      const filter = createFilterStore({ navLanguages: ["en"] });
      const h = harness({ filter });
      h.app[modal].value = true;

      expect(h.controller.command("toggle-select-mode")).toBe(true);
      expect(h.controller.command("add-to-list")).toBe(true);
      expect(h.controller.command("toggle-filter")).toBe(true);
      expect(h.controller.command("not-interested")).toBe(true);
      expect(h.controller.command("undo")).toBe(true);

      expect(h.selection.selectMode.value).toBe(false);
      expect(h.selection.count.value).toBe(0);
      expect(h.app.pickerOpen.value).toBe(false);
      expect(filter.state.value.enabled).toBe(true);
      expect(h.quick.notInterested).not.toHaveBeenCalled();
    },
  );

  it("Picker consumes commands while focus is on its non-input controls", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.selection.add({ screenName: "kept" });
    h.app.pickerOpen.value = true;

    expect(h.controller.command("help")).toBe(true);
    expect(h.controller.command("toggle-select-mode")).toBe(true);
    expect(h.controller.command("add-to-list")).toBe(true);
    expect(h.controller.command("add-to-default-list")).toBe(true);
    expect(h.controller.command("toggle-filter")).toBe(true);
    expect(h.controller.command("undo")).toBe(true);

    expect(h.app.shortcutsOpen.value).toBe(false);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.selectMode.value).toBe(false);
    expect(h.selection.list()).toEqual([{ screenName: "kept" }]);
    expect(filter.state.value.enabled).toBe(true);
  });

  it("Escape closes the current modal before the Picker", async () => {
    const dispose = vi.fn();
    const h = harness({
      pickerMembershipStore: {
        recordAssign: async () => {},
        reconcileAuthor: async () => {},
        replaceCatalog: async () => {},
        observe: () => dispose,
      },
    });
    h.controller.openPicker();
    await flush();
    h.app.shortcutsOpen.value = true;

    expect(h.controller.command("escape")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(false);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("after 3 individual selections, nudges toward select mode — once", async () => {
    const h = harness();
    for (const s of ["a", "b", "c"]) h.controller.toggleSelect({ screenName: s });
    await flush();
    expect(titles(h)).toContain("Tip: press s to select by clicking posts");
    h.toasts.clear();
    h.controller.toggleSelect({ screenName: "d" });
    await flush();
    expect(titles(h)).toEqual([]);
  });

  it("toggling an already-selected author off does not count toward the nudge", () => {
    const h = harness();
    h.controller.toggleSelect({ screenName: "a" }); // select
    h.controller.toggleSelect({ screenName: "a" }); // deselect (wasSelected)
    h.controller.toggleSelect({ screenName: "b" });
    h.controller.toggleSelect({ screenName: "c" });
    // Only 3 distinct *first* selections trip the nudge; the deselect above isn't one.
    expect(titles(h)).toEqual([]);
  });

  it("selections made inside select mode never trigger the individual nudge", async () => {
    const h = harness();
    h.selection.setSelectMode(true);
    for (const s of ["a", "b", "c"]) h.controller.toggleSelect({ screenName: s });
    await flush();
    expect(titles(h)).toEqual([]);
  });

  it("the select-mode nudge stays silent once the hint window has decayed", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.coach.recordAssign(); // exhaust the decay window
    for (const s of ["a", "b", "c"]) h.controller.toggleSelect({ screenName: s });
    await flush();
    expect(titles(h)).toEqual([]); // tryShowTip returned false ⇒ no toast
  });

  it("the undo window matches the story's 10 seconds", () => {
    expect(UNDO_WINDOW_MS).toBe(10_000);
  });
});

function recordingStore() {
  const calls: Array<{
    owner: Owner;
    ownerObservedAt: number;
    list: XList;
    changes: MembershipChange[];
  }> = [];
  const store: MembershipStore = {
    recordAssign: async (o, l, observation) => {
      calls.push({
        owner: o,
        ownerObservedAt: observation.ownerObservedAt,
        list: l,
        changes: [...observation.changes],
      });
    },
    reconcileAuthor: async () => {},
    replaceCatalog: async () => {},
    observe: () => () => {},
  };
  return { store, calls };
}

describe("Mirror is off-to-the-side (ADR-0009)", () => {
  const owner: Owner = { userId: "1", screenName: "me" };

  it("records the assign run to the Mirror with the acting Owner", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a", userId: "7" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toEqual(owner);
    expect(calls[0]?.list.id).toBe("L1");
    expect(calls[0]?.changes).toEqual([
      {
        screenName: "a",
        userId: "7",
        identity: "user:7",
        action: "add",
        outcome: "added",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
      {
        screenName: "b",
        identity: null,
        action: "add",
        outcome: "added",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
    ]);
  });

  it("passes a DOM receipt to the Mirror as ui-state evidence", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner, evidence: "ui-state" });
    h.selection.add({ screenName: "a", userId: "7" });

    await h.assign(LISTS[0] as XList);
    await flush();

    expect(calls[0]?.changes[0]).toMatchObject({
      action: "add",
      outcome: "added",
      evidence: "ui-state",
    });
  });

  it("timestamps the Owner profile when it is re-read after a long assign", async () => {
    let handle = "old-handle";
    const { store, calls } = recordingStore();
    const h = harness({
      membershipStore: store,
      currentOwner: () => ({ userId: owner.userId, screenName: handle }),
    });
    h.backend.addImpl = async () => {
      handle = "new-handle";
    };
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0] as XList);
    await flush();

    expect(calls[0]?.owner).toEqual({ userId: owner.userId, screenName: "new-handle" });
    expect(calls[0]?.ownerObservedAt).toBe(Date.UTC(2026, 5, 10));
  });

  it("skips the Mirror when no Owner is logged in (still assigns on X)", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => null });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(calls).toEqual([]);
    expect(h.backend.added).toEqual(["a"]);
  });

  it("a throwing Mirror leaves the assign + undo flow byte-identical", async () => {
    const store: MembershipStore = {
      recordAssign: async () => {
        throw new Error("convex down");
      },
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => () => {},
    };
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(h.backend.added).toEqual(["a", "b"]);
    expect(h.selection.count.value).toBe(0);
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe("Added 2 to Design Folks");
    expect(toast?.actions?.map((a) => a.label)).toEqual(["View List", "Undo"]);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a", "b"]);
  });

  it("a synchronously-throwing Mirror leaves the assign + undo flow intact and warns once (C3/C1)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: MembershipStore = {
      // NOT async — throws synchronously, before returning a promise .catch could attach to.
      recordAssign: () => {
        throw new Error("sync boom");
      },
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => () => {},
    };
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList); // recordToMirror #1 (sync throw)
    await flush();
    expect(h.backend.added).toEqual(["a"]); // X flow unaffected by the sync throw
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a"]); // undo path #2 also survives
    expect(warn).toHaveBeenCalledTimes(1); // one-time: the second failure is silent
    warn.mockRestore();
  });

  it("mirrors undo removals as remove changes", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    h.controller.command("undo");
    await flush();
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes).toEqual([
      {
        screenName: "a",
        identity: null,
        action: "remove",
        outcome: "removed",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
    ]);
  });

  it("times each assign and undo fact when its own X attempt settles", async () => {
    let clock = 10;
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner, now: () => clock++ });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    h.controller.command("undo");
    await flush();

    const assign = calls.find((call) => call.changes[0]?.action === "add");
    const removal = calls.find((call) => call.changes[0]?.action === "remove");
    expect(assign?.changes.map((change) => change.observedAt)).toEqual([10, 11]);
    expect(assign?.ownerObservedAt).toBe(12);
    expect(removal?.changes.map((change) => change.observedAt)).toEqual([14, 15]);
    expect(removal?.ownerObservedAt).toBe(16);
  });

  it("a partial undo reports the real count and mirrors the failed remove", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a", userId: "9" });
    await h.assign(LISTS[0] as XList);
    h.backend.removeMember = async () => {
      throw new Error("remove failed");
    };
    h.controller.command("undo");
    await flush();
    expect(titles(h)).toContain("Removed 0 from Design Folks");
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes).toEqual([
      {
        screenName: "a",
        userId: "9",
        identity: "user:9",
        action: "remove",
        outcome: "failed",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
    ]);
  });

  it("a partial undo still gets reported with the real count", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a", userId: "9" });
    h.selection.add({ screenName: "b", userId: "10" });
    await h.assign(LISTS[0] as XList);
    h.backend.removeMember = async (_list, author) => {
      if (author.screenName === "b") throw new Error("remove failed");
      h.backend.removed.push(author.screenName);
    };
    h.controller.command("undo");
    await flush();
    expect(titles(h)).toContain("Removed 1 from Design Folks");
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes).toEqual([
      {
        screenName: "a",
        userId: "9",
        identity: "user:9",
        action: "remove",
        outcome: "removed",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
      {
        screenName: "b",
        userId: "10",
        identity: "user:10",
        action: "remove",
        outcome: "failed",
        evidence: "server-response",
        observedAt: Date.UTC(2026, 5, 10),
      },
    ]);
  });

  it("a rate-limited mid-undo stops and keeps un-attempted authors out of the Mirror", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    for (const s of ["a", "b", "c"]) h.selection.add({ screenName: s });
    await h.assign(LISTS[0] as XList);
    h.backend.removeMember = async (_list, author) => {
      h.backend.removed.push(author.screenName);
      if (author.screenName === "b") throw new XApiError("rate-limited", "429");
    };

    h.controller.command("undo");
    await flush();

    expect(h.backend.removed).toEqual(["a", "b"]); // c never attempted
    expect(titles(h)).toContain("Removed 1 from Design Folks");
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes.map((c) => [c.screenName, c.outcome])).toEqual([
      ["a", "removed"],
      ["b", "rate-limited"],
    ]);
  });

  it("reports a settled Mirror write via onMirrorResult (popup's instant status row)", async () => {
    const { store } = recordingStore();
    const onMirrorResult = vi.fn();
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      mirrorConfigurationId: () => "mirror-1",
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledWith({
      ok: true,
      configId: "mirror-1",
    });
  });

  it("attributes an in-flight A result to A after settings switch to B", async () => {
    const pending = deferred<void>();
    let configId = "mirror-a";
    const store: MembershipStore = {
      recordAssign: () => pending.promise,
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => () => {},
    };
    const onMirrorResult = vi.fn();
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      mirrorConfigurationId: () => configId,
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);

    configId = "mirror-b";
    pending.resolve();
    await flush();

    expect(onMirrorResult).toHaveBeenCalledWith({
      ok: true,
      configId: "mirror-a",
    });
  });

  it("still writes when reading the optional Mirror status identity throws", async () => {
    const { store, calls } = recordingStore();
    const onMirrorResult = vi.fn();
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      mirrorConfigurationId: () => {
        throw new Error("status identity unavailable");
      },
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0] as XList);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(calls).toHaveLength(1);
    expect(onMirrorResult).not.toHaveBeenCalled();
  });

  it("a rejecting Mirror status sink cannot become a Mirror failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, calls } = recordingStore();
    const onMirrorResult = vi.fn(async () => {
      throw new Error("status storage gone");
    });
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      mirrorConfigurationId: () => "mirror-1",
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0] as XList);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(calls).toHaveLength(1);
    expect(onMirrorResult).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("contains a throwing status sink after a real Mirror failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: MembershipStore = {
      recordAssign: async () => {
        throw new Error("Mirror unavailable");
      },
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => () => {},
    };
    const onMirrorResult = vi.fn(() => {
      throw new Error("status storage gone");
    });
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      mirrorConfigurationId: () => "mirror-1",
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });

    await h.assign(LISTS[0] as XList);
    await flush();

    expect(h.backend.added).toEqual(["a"]);
    expect(onMirrorResult).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reports async and sync Mirror failures via onMirrorResult", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onMirrorResult = vi.fn();
    const asyncFail: MembershipStore = {
      recordAssign: async () => {
        throw new Error("convex down");
      },
      reconcileAuthor: async () => {},
      replaceCatalog: async () => {},
      observe: () => () => {},
    };
    const h = harness({
      membershipStore: asyncFail,
      currentOwner: () => owner,
      mirrorConfigurationId: () => "mirror-1",
      onMirrorResult,
    });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledWith({
      ok: false,
      configId: "mirror-1",
    });

    const syncFail: MembershipStore = {
      ...asyncFail,
      recordAssign: () => {
        throw new Error("sync boom");
      },
    };
    const h2 = harness({
      membershipStore: syncFail,
      currentOwner: () => owner,
      mirrorConfigurationId: () => "mirror-1",
      onMirrorResult,
    });
    h2.selection.add({ screenName: "b" });
    await h2.assign(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledTimes(2);
    expect(onMirrorResult).toHaveBeenLastCalledWith({
      ok: false,
      configId: "mirror-1",
    });
    warn.mockRestore();
  });

  it("skips the Mirror when a run produces no changes (stopped before the first add)", async () => {
    const { store, calls } = recordingStore();
    // usage.record fires synchronously before the assign loop and trips Stop,
    // so shouldStop() is true at i=0 and assignAuthorsToList returns no results.
    const h = harness({
      membershipStore: store,
      currentOwner: () => owner,
      usage: { record: async () => h.controller.stopRun() },
    });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(calls).toEqual([]); // recordToMirror short-circuits on the empty change set
  });
});

describe("Filter conductor is never load-bearing (ADR-0010)", () => {
  it("a throwing filter command leaves the assign + undo flow byte-identical", async () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    // A filter command that throws must be swallowed by the walled section and
    // never touch the X flow (mirrors the throwing-Mirror proof above).
    expect(() =>
      h.controller.filterCommand(() => {
        throw new Error("filter boom");
      }),
    ).not.toThrow();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.assign(LISTS[0] as XList);
    await flush();
    expect(h.backend.added).toEqual(["a", "b"]);
    expect(h.selection.count.value).toBe(0);
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe("Added 2 to Design Folks");
    expect(toast?.actions?.map((a) => a.label)).toEqual(["View List", "Undo"]);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a", "b"]);
  });

  it("conducts a succeeding filter command against the wired store", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.cycle("kind:video"));
    expect(filter.state.value.criteria["kind:video"]).toBe("only");
  });

  it("is a safe no-op when no filter store is wired", () => {
    const h = harness(); // no filter
    expect(() => h.controller.filterCommand(() => {})).not.toThrow();
  });

  it("a state-changing filter command arms undo, and Z reverts it", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.cycle("kind:video"));
    expect(filter.state.value.criteria["kind:video"]).toBe("only");
    expect(h.controller.command("undo")).toBe(true); // Z
    expect(filter.state.value.criteria["kind:video"]).toBeUndefined(); // reverted to the snapshot
  });

  it("a filter command that changes no persistent state arms no undo", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.setRevealed(true)); // transient reveal — no FilterState change
    expect(filter.revealed.value).toBe(true);
    expect(h.controller.command("undo")).toBe(false); // nothing armed → left for X
  });

  it("Z after a 'show all' peek both reverts the criteria and re-hides — undo is visible", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.cycle("kind:video")); // arms undo
    h.controller.filterCommand((s) => s.setRevealed(true)); // transient peek — doesn't re-arm
    expect(h.controller.command("undo")).toBe(true); // Z
    expect(filter.state.value.criteria["kind:video"]).toBeUndefined(); // config reverted…
    expect(filter.revealed.value).toBe(false); // …and the peek ended, so the revert is visible
  });

  it("conducting applyPreset is one batched undo that reverts the whole preset (goal 4b)", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    filter.setMode("kind:video", "hide");
    filter.setMode("kind:link", "only");
    const id = filter.savePreset("P");
    filter.setMode("kind:video", "off"); // move away from the preset
    filter.setMode("kind:link", "off");
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.applyPreset(id));
    expect(filter.state.value.criteria).toEqual({
      "kind:video": "hide",
      "kind:link": "only",
    });
    expect(h.controller.command("undo")).toBe(true); // one Z
    expect(filter.state.value.criteria).toEqual({}); // the whole batch reverted in one entry
  });

  it("undo is last-wins across filter and assign: a later assign owns Z", async () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.cycle("kind:video")); // arms a filter undo
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList); // arms the assign undo (replaces)
    await flush();
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a"]); // the assign was undone (last-wins)
    expect(filter.state.value.criteria["kind:video"]).toBe("only"); // filter change left intact
  });
});

describe("keyboard command surface (story beat 6)", () => {
  it("toggle-select-mode flips select mode on then off", () => {
    const h = harness();
    expect(h.controller.command("toggle-select-mode")).toBe(true);
    expect(h.selection.selectMode.value).toBe(true);
    expect(h.controller.command("toggle-select-mode")).toBe(true);
    expect(h.selection.selectMode.value).toBe(false);
  });

  it("toggle-filter flips the master filter, arms undo, and Z reverts it", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    expect(filter.state.value.enabled).toBe(true);
    expect(h.controller.command("toggle-filter")).toBe(true);
    expect(filter.state.value.enabled).toBe(false);
    expect(h.controller.command("undo")).toBe(true); // Z
    expect(filter.state.value.enabled).toBe(true);
    expect(h.controller.command("toggle-filter")).toBe(true); // and back off again
    expect(filter.state.value.enabled).toBe(false);
  });

  it("toggle-reveal peeks hidden posts and re-hides on the second press (no undo armed)", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    expect(h.controller.command("toggle-reveal")).toBe(true);
    expect(filter.revealed.value).toBe(true);
    expect(h.controller.command("undo")).toBe(false); // transient — nothing armed
    expect(h.controller.command("toggle-reveal")).toBe(true);
    expect(filter.revealed.value).toBe(false);
  });

  it("toggle-filter / toggle-reveal fall through to X when no filter store is wired", () => {
    const h = harness(); // no filter
    expect(h.controller.command("toggle-filter")).toBe(false);
    expect(h.controller.command("toggle-reveal")).toBe(false);
  });

  it("leaves Filter keys and direct commands inert off-route, then resumes on a timeline", () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    let inScope = false;
    const h = harness({ filter, filterInScope: () => inScope });

    h.controller.filterCommand((store) => store.setEnabled(false));
    expect(h.controller.command("toggle-filter")).toBe(false);
    expect(h.controller.command("toggle-reveal")).toBe(false);
    expect(filter.state.value.enabled).toBe(true);
    expect(filter.revealed.value).toBe(false);
    expect(h.controller.command("undo")).toBe(false);

    inScope = true;
    expect(h.controller.command("toggle-filter")).toBe(true);
    expect(filter.state.value.enabled).toBe(false);
  });

  it("toggle-select selects the focused author", () => {
    const h = harness();
    expect(h.controller.command("toggle-select")).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("toggle-select with no target nudges", () => {
    const h = harness({ targetAuthor: null });
    expect(h.controller.command("toggle-select")).toBe(true);
    expect(titles(h)).toEqual(["Hover a post first — or press j to focus one"]);
  });

  it("add-to-list with an existing selection opens the picker without re-adding", () => {
    const h = harness();
    h.selection.add({ screenName: "alreadythere" });
    expect(h.controller.command("add-to-list")).toBe(true);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.count.value).toBe(1);
  });

  it("add-to-default-list is dispatched from the keyboard chord", async () => {
    const h = harness();
    await h.settings.set({
      defaultList: { ownerUserId: OWNER.userId, listId: "L1" },
    });
    expect(h.controller.command("add-to-default-list")).toBe(true);
    await flush();
    expect(h.backend.added).toEqual(["jane"]);
  });

  it("mute is dispatched for the focused author; nudges when none", () => {
    const h = harness();
    expect(h.controller.command("mute")).toBe(true);
    const none = harness({ targetAuthor: null });
    expect(none.controller.command("mute")).toBe(true);
    expect(titles(none)).toEqual(["Hover a post first — or press j to focus one"]);
  });

  it("block is dispatched for the focused author; nudges when none", () => {
    const h = harness({ withBlock: true });
    expect(h.controller.command("block")).toBe(true);
    const none = harness({ targetAuthor: null, withBlock: true });
    expect(none.controller.command("block")).toBe(true);
    expect(titles(none)).toEqual(["Hover a post first — or press j to focus one"]);
  });

  it("not-interested hides the focused tweet; nudges when none", () => {
    const h = harness();
    expect(h.controller.command("not-interested")).toBe(true);
    const none = harness({ targetTweet: null });
    expect(none.controller.command("not-interested")).toBe(true);
    expect(titles(none)).toEqual(["Hover a post first — or press j to focus one"]);
  });
});

describe("block quick action (story beat 6)", () => {
  it("success: past-tense toast", async () => {
    const h = harness({ withBlock: true });
    h.controller.command("block");
    await flush();
    expect(h.quick.block).toHaveBeenCalledWith("jane");
    expect(titles(h)).toEqual(["Blocked @jane"]);
  });

  it("failure: literal danger toast with a working Retry", async () => {
    let calls = 0;
    const h = harness({
      withBlock: true,
      block: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
      },
    });
    h.controller.command("block");
    await flush();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.kind).toBe("danger");
    expect(toast?.title).toBe("Couldn't block @jane");
    const retry = toast?.actions?.find((a) => a.label === "Retry");
    retry?.run();
    await flush();
    expect(calls).toBe(2);
  });

  it("no-op when the host provides no block capability", async () => {
    const h = harness();
    h.controller.command("block");
    await flush();
    expect(titles(h)).toEqual([]);
  });
});

describe("mute / unmute / hide failure + retry seams", () => {
  it("mute Undo action triggers the armed unmute", async () => {
    const h = harness();
    h.controller.command("mute");
    await flush();
    const id = h.toasts.toasts.value[0]?.id as number;
    h.toasts.act(id, 0); // the Undo action
    await flush();
    expect(h.quick.unmute).toHaveBeenCalledWith("jane");
  });

  it("mute failure Retry re-attempts the mute", async () => {
    const h = harness();
    h.quick.mute.mockRejectedValueOnce(new Error("boom"));
    h.controller.command("mute");
    await flush();
    const danger = h.toasts.toasts.value[0];
    expect(danger?.kind).toBe("danger");
    danger?.actions?.[0]?.run(); // Retry
    await flush();
    expect(h.quick.mute).toHaveBeenCalledTimes(2);
  });

  it("a failing unmute reports the literal failure copy", async () => {
    const h = harness();
    h.quick.unmute.mockRejectedValueOnce(new Error("boom"));
    h.controller.command("mute");
    await flush();
    h.controller.command("undo");
    await flush();
    expect(titles(h)).toContain("Couldn't mute @jane");
  });

  it("hide failure: literal danger toast with a working Retry", async () => {
    const h = harness();
    h.quick.notInterested.mockRejectedValueOnce(new Error("boom"));
    h.controller.command("not-interested");
    await flush();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.kind).toBe("danger");
    expect(toast?.title).toBe("Couldn't hide that post");
    toast?.actions?.[0]?.run(); // Retry
    await flush();
    expect(h.quick.notInterested).toHaveBeenCalledTimes(2);
  });
});

describe("assign toast Undo action + default-list cache fallback", () => {
  it("the success toast's Undo action removes what was added", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    const toast = h.toasts.toasts.value[0];
    const undoAction = toast?.actions?.find((a) => a.label === "Undo");
    undoAction?.run();
    await flush();
    expect(h.backend.removed).toEqual(["a"]);
  });

  it("releases Undo while the post-assign coaching read is still pending", async () => {
    const h = harness();
    const tip = deferred<boolean>();
    vi.spyOn(h.coach, "tryShowTip").mockReturnValue(tip.promise);
    h.selection.add({ screenName: "a" });

    const assignment = h.assign(LISTS[0] as XList);
    await vi.waitFor(() => expect(h.toasts.toasts.value[0]?.title).toBe("Added 1 to Design Folks"));
    h.toasts.toasts.value[0]?.actions?.find((action) => action.label === "Undo")?.run();
    await flush();

    expect(h.backend.removed).toEqual(["a"]);
    tip.resolve(false);
    await assignment;
  });

  it("swallows a rejected post-assign coaching hint", async () => {
    const h = harness();
    vi.spyOn(h.coach, "tryShowTip").mockRejectedValue(new Error("coach unavailable"));
    h.selection.add({ screenName: "a" });

    await expect(h.assign(LISTS[0] as XList)).resolves.toBeUndefined();
    await flush();
  });

  it("an empty selection is a no-op assign", async () => {
    const h = harness();
    await h.assign(LISTS[0] as XList);
    expect(h.backend.added).toEqual([]);
    expect(h.app.running.value).toBeNull();
    expect(titles(h)).toEqual([]);
  });

  it("default list set but cache throws: falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({
      defaultList: { ownerUserId: OWNER.userId, listId: "L1" },
    });
    h.cache.cached = async () => {
      throw new Error("offline");
    };
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("default list set but the id is missing from the cache: falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({
      defaultList: { ownerUserId: OWNER.userId, listId: "does-not-exist" },
    });
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("does not assign a cached default after its Owner changes during the lookup", async () => {
    let owner = OWNER;
    const cached = deferred<XList[]>();
    const cachedStarted = deferred<void>();
    const h = harness({ currentOwner: () => owner });
    await h.settings.set({ defaultList: { ownerUserId: OWNER.userId, listId: "L1" } });
    h.cache.cached = async () => {
      cachedStarted.resolve();
      return cached.promise;
    };

    h.controller.command("add-to-default-list");
    await cachedStarted.promise;
    owner = { userId: "200", screenName: "other" };
    cached.resolve(LISTS);
    await flush();

    expect(h.backend.added).toEqual([]);
    expect(h.selection.list()).toEqual([{ screenName: "jane" }]);
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("a default List owned by another account falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({ defaultList: { ownerUserId: "200", listId: "L1" } });
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("migrates a legacy default only after fresh active-Owner X proof", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "L1" });
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual(["jane"]);
    expect((await h.settings.get()).defaultList).toEqual({
      ownerUserId: OWNER.userId,
      listId: "L1",
    });
  });

  it("does not assign or migrate a legacy default after its Owner changes during refresh", async () => {
    let owner = OWNER;
    const refresh = deferred<XList[]>();
    const refreshStarted = deferred<void>();
    const h = harness({ currentOwner: () => owner });
    await h.settings.set({ defaultListId: "L1" });
    h.cache.refresh = async () => {
      refreshStarted.resolve();
      return refresh.promise;
    };

    h.controller.command("add-to-default-list");
    await refreshStarted.promise;
    owner = { userId: "200", screenName: "other" };
    refresh.resolve(LISTS);
    await flush();

    expect(h.backend.added).toEqual([]);
    expect((await h.settings.get()).defaultList).toBeUndefined();
    expect(h.selection.list()).toEqual([{ screenName: "jane" }]);
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("does not migrate a legacy default absent from fresh X truth", async () => {
    const h = harness({ lists: [] });
    await h.settings.set({ defaultListId: "deleted" });
    h.controller.command("add-to-default-list");
    await flush();
    expect((await h.settings.get()).defaultList).toBeUndefined();
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("falls back to the picker when legacy-default proof fails", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "L1" });
    h.cache.refresh = async () => {
      throw new Error("offline");
    };
    h.controller.command("add-to-default-list");
    await flush();
    expect((await h.settings.get()).defaultList).toBeUndefined();
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("does not remigrate a legacy default after it is cleared", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "L1" });
    await h.settings.set({ defaultList: undefined, defaultListId: undefined });

    h.controller.command("add-to-default-list");
    await flush();

    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
  });

  it("keeps X successful when legacy migration settings writes throw or reject", async () => {
    for (const set of [
      (() => {
        throw new Error("sync settings failure");
      }) as unknown as import("@/core/settings").SettingsStore["set"],
      async () => Promise.reject(new Error("async settings failure")),
    ]) {
      const base = createSettings(memoryArea());
      await base.set({ defaultListId: "L1" });
      const h = harness({ settings: { ...base, set } });

      h.controller.command("add-to-default-list");
      await flush();

      expect(h.backend.added).toEqual(["jane"]);
    }
  });

  it("add-to-default-list nudges when there is no focused author", async () => {
    const h = harness({ targetAuthor: null });
    h.controller.command("add-to-default-list");
    await flush();
    expect(titles(h)).toEqual(["Hover a post first — or press j to focus one"]);
  });
});

describe("keyboard-anchored picker (story beat 6)", () => {
  it("anchors the picker at the caret corner for keyboard opens", () => {
    const h = harness({ anchorFor: () => ({ left: 120, top: 240 }) });
    h.controller.openPicker("keyboard");
    expect(h.app.pickerAnchor.value).toEqual({ left: 120, top: 240 });
  });

  it("a zero-rect anchor resolves to null (bottom-center)", () => {
    const h = harness({ anchorFor: () => null });
    h.controller.openPicker("keyboard");
    expect(h.app.pickerAnchor.value).toBeNull();
  });

  it("keyboard open with no resolvable tweet leaves the anchor null", () => {
    const h = harness({
      targetTweet: null,
      anchorFor: () => ({ left: 1, top: 1 }),
    });
    h.controller.openPicker("keyboard");
    expect(h.app.pickerAnchor.value).toBeNull();
  });

  it("pointer opens are never anchored", () => {
    const h = harness({ anchorFor: () => ({ left: 5, top: 5 }) });
    h.controller.openPicker("pointer");
    expect(h.app.pickerAnchor.value).toBeNull();
  });
});

describe("onboarding gestures + ambient toasts", () => {
  it("trySelectMode enters select mode, closes welcome, marks onboarded", async () => {
    const h = harness();
    h.app.welcomeOpen.value = true;
    h.controller.trySelectMode();
    expect(h.selection.selectMode.value).toBe(true);
    expect(h.app.welcomeOpen.value).toBe(false);
    await flush();
    expect(await h.coach.isOnboarded()).toBe(true);
  });

  it("skipWelcome closes welcome and marks onboarded without select mode", async () => {
    const h = harness();
    h.app.welcomeOpen.value = true;
    h.controller.skipWelcome();
    expect(h.app.welcomeOpen.value).toBe(false);
    expect(h.selection.selectMode.value).toBe(false);
    await flush();
    expect(await h.coach.isOnboarded()).toBe(true);
  });

  it("wake surfaces the wake toast", () => {
    const h = harness();
    h.controller.wake();
    expect(titles(h)).toEqual(["Lasso is awake on this tab"]);
  });

  it("reportBreakage surfaces the selector-health toast for 8s", () => {
    const h = harness();
    h.controller.reportBreakage();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe(
      "Lasso can't read the timeline — X may have changed. Check for an update.",
    );
    expect(toast?.durationMs).toBe(8000);
  });
});

describe("default clock fallback", () => {
  it("uses Date.now when no clock is injected", async () => {
    const h = harness({ omitNow: true });
    h.selection.add({ screenName: "a" });
    await h.assign(LISTS[0] as XList);
    expect(h.backend.added).toEqual(["a"]);
    expect(h.toasts.toasts.value[0]?.title).toBe("Added 1 to Design Folks");
  });
});

// --- Alt+Shift+B: file the post under the cursor into the default Folder ------

const SAVE_STATUS = "1234567890";
const FOLDER_ID = "fld_abcdefghijklmnopqrst";

/** A timeline cell whose host post is `statusId`, optionally quoting another. */
function postCell(statusId: string, quoted?: string): Element {
  const wrap = document.createElement("div");
  wrap.innerHTML =
    `<article data-testid="tweet">` +
    `<div data-testid="User-Name"><a href="/jack">Jack</a>` +
    `<a href="/jack/status/${statusId}">@jack</a></div>` +
    `<div data-testid="tweetText">host</div>` +
    (quoted
      ? `<div><article data-testid="tweet"><div data-testid="User-Name">` +
        `<a href="/ada">Ada</a><a href="/ada/status/${quoted}">@ada</a></div></article></div>`
      : "") +
    `</article>`;
  document.body.append(wrap);
  return wrap.querySelector("article") as Element;
}

const savedOutcome = (
  over: Partial<Extract<DefaultSaveOutcome, { status: "saved" }>> = {},
): DefaultSaveOutcome => ({
  status: "saved",
  saved: "created",
  createdSavedPost: true,
  folderId: FOLDER_ID,
  folderName: "Research",
  statusId: SAVE_STATUS,
  ...over,
});

function saveHarness(
  answer: DefaultSaveOutcome | (() => Promise<DefaultSaveOutcome>) = savedOutcome(),
  targetTweet?: Element | null,
) {
  const captures: (string | null)[] = [];
  const undone: SavedByGesture[] = [];
  const collections: CollectionsClient = {
    saveToDefaultFolder: vi.fn(async (capture) => {
      captures.push(capture.statusId);
      return typeof answer === "function" ? await answer() : answer;
    }),
    undoSave: vi.fn(async (save) => {
      undone.push(save);
    }),
  };
  const h = harness({ collections, targetTweet });
  return { ...h, collections, captures, undone };
}

const settle = () => new Promise((done) => setTimeout(done, 0));
const toastTitles = (h: { toasts: ReturnType<typeof createToastStore> }) =>
  h.toasts.toasts.value.map((toast) => toast.title);

describe("save to the default Folder", () => {
  it("saves, names the Folder and arms Undo that reverses just this gesture", async () => {
    const h = saveHarness(savedOutcome(), postCell(SAVE_STATUS));
    expect(h.controller.command("save-to-default-folder")).toBe(true);
    await settle();

    expect(h.captures).toEqual([SAVE_STATUS]);
    expect(toastTitles(h)).toEqual(["Saved to Research"]);
    expect(h.toasts.toasts.value[0]?.actions?.[0]).toMatchObject({ label: "Undo", kbd: "Z" });

    h.undo.trigger();
    await settle();
    expect(h.undone).toEqual([
      { folderId: FOLDER_ID, statusId: SAVE_STATUS, createdSavedPost: true },
    ]);
  });

  it("files the HOST post when the cursor sits inside a quoted post", async () => {
    const host = postCell(SAVE_STATUS, "999");
    const h = saveHarness(savedOutcome(), host.querySelector("article") as Element);
    h.controller.command("save-to-default-folder");
    await settle();
    // identity() would have taken the quoted id; the durable capture does not.
    expect(h.captures).toEqual([SAVE_STATUS]);
  });

  it("captures synchronously, so a recycled article cannot change the answer", async () => {
    let release!: (outcome: DefaultSaveOutcome) => void;
    const element = postCell(SAVE_STATUS);
    const h = saveHarness(() => new Promise((resolve) => (release = resolve)), element);

    h.controller.command("save-to-default-folder");
    element.remove(); // the timeline virtualizes; the article is gone mid-flight
    release(savedOutcome());
    await settle();

    expect(h.captures).toEqual([SAVE_STATUS]);
    expect(toastTitles(h)).toEqual(["Saved to Research"]);
  });

  it("says already-there and arms no Undo, leaving an earlier one triggerable", async () => {
    const h = saveHarness(
      savedOutcome({ saved: "already-there", createdSavedPost: false }),
      postCell(SAVE_STATUS),
    );
    const earlier = vi.fn();
    h.undo.arm(earlier, 10_000);

    h.controller.command("save-to-default-folder");
    await settle();

    expect(toastTitles(h)).toEqual(["Already in Research"]);
    h.undo.trigger();
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(h.undone).toEqual([]);
  });

  it("refuses a post whose durable identity cannot be read", async () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText">no link</div></article>`;
    const h = saveHarness(savedOutcome(), wrap.querySelector("article") as Element);

    h.controller.command("save-to-default-folder");
    await settle();

    expect(h.collections.saveToDefaultFolder).not.toHaveBeenCalled();
    expect(toastTitles(h)).toEqual(["Can't save this post — X exposed no link for it"]);
    expect(h.undo.trigger()).toBe(false);
  });

  it("nudges when nothing is under the cursor", async () => {
    const h = saveHarness(savedOutcome(), null);
    expect(h.controller.command("save-to-default-folder")).toBe(true);
    await settle();
    expect(toastTitles(h)).toEqual(["Hover a post first — or press j to focus one"]);
    expect(h.collections.saveToDefaultFolder).not.toHaveBeenCalled();
  });

  it("points at Options when the user chose always-ask", async () => {
    const h = saveHarness({ status: "ask" }, postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();
    expect(toastTitles(h)).toEqual(["No default Folder set — choose one in Options"]);
    expect(h.undo.trigger()).toBe(false);
  });

  it("relays an unsavable answer from the worker", async () => {
    const h = saveHarness({ status: "unsavable" }, postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();
    expect(toastTitles(h)).toEqual(["Can't save this post — X exposed no link for it"]);
  });

  it("offers Retry on failure, having written nothing and armed no Undo", async () => {
    const h = saveHarness(() => Promise.reject(new Error("worker down")), postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();

    expect(toastTitles(h)).toEqual(["Couldn't save this post"]);
    expect(h.toasts.toasts.value[0]?.actions?.[0]?.label).toBe("Retry");
    expect(h.undo.trigger()).toBe(false);
  });

  it("reports failure when Folders are not wired at all", async () => {
    const h = harness({ targetTweet: postCell(SAVE_STATUS) });
    h.controller.command("save-to-default-folder");
    await settle();
    expect(toastTitles(h)).toEqual(["Couldn't save this post"]);
  });

  it("keeps the Saved Post on Undo when this gesture did not mint it", async () => {
    const h = saveHarness(savedOutcome({ createdSavedPost: false }), postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();
    h.undo.trigger();
    await settle();
    expect(h.undone[0]).toMatchObject({ createdSavedPost: false });
  });

  it("runs Undo from the toast action and Retry from the danger toast", async () => {
    const h = saveHarness(savedOutcome(), postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();
    // The toast's own Undo button, not the keyboard path.
    h.toasts.toasts.value[0]?.actions?.[0]?.run();
    await settle();
    expect(h.undone).toHaveLength(1);

    let attempts = 0;
    const retryable = saveHarness(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("worker down"))
        : Promise.resolve(savedOutcome());
    }, postCell(SAVE_STATUS));
    retryable.controller.command("save-to-default-folder");
    await settle();
    retryable.toasts.toasts.value[0]?.actions?.[0]?.run();
    await settle();
    expect(attempts).toBe(2);
  });

  it("makes no network request across a save and its undo", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const h = saveHarness(savedOutcome(), postCell(SAVE_STATUS));
    h.controller.command("save-to-default-folder");
    await settle();
    h.undo.trigger();
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
