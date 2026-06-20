import { describe, expect, it, vi } from "vitest";

import { createAppState } from "@/content/app-state";
import { createLassoController, UNDO_WINDOW_MS } from "@/content/controller";
import { createCoach } from "@/core/coach";
import type { ListCache } from "@/core/list-cache";
import type { MembershipChange, MembershipStore, Owner } from "@/core/membership-store/types";
import { createPickerController } from "@/core/picker-controller";
import { createSelectionStore, type TweetAuthor } from "@/core/selection-store";
import { createSettings } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import { createUndoRegistry } from "@/core/undo";
import { XApiError, type XList, type XListApi } from "@/core/x-client/types";

const LISTS: XList[] = [
  { id: "L1", name: "Design Folks" },
  { id: "L2", name: "Founders" },
];

class FakeApi implements XListApi {
  added: string[] = [];
  removed: string[] = [];
  addImpl: (author: TweetAuthor) => Promise<void> = async () => {};
  async getLists(): Promise<XList[]> {
    return LISTS;
  }
  async resolveUserId(): Promise<string | null> {
    return null;
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
    async lists() {
      return lists;
    },
    async search() {
      return lists;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(
  opts: {
    targetAuthor?: TweetAuthor | null;
    targetTweet?: Element | null;
    lists?: XList[];
    membershipStore?: MembershipStore;
    currentOwner?: () => Owner | null;
    block?: (s: string) => Promise<void>;
    withBlock?: boolean;
    anchorFor?: (tweetEl: Element) => { left: number; top: number } | null;
    omitNow?: boolean;
    usage?: { record: (listId: string) => Promise<void> };
  } = {},
) {
  const selection = createSelectionStore();
  const app = createAppState(selection);
  const backend = new FakeApi();
  const cache = fakeCache(opts.lists ?? LISTS);
  const picker = createPickerController({ cache });
  const toasts = createToastStore({ setTimer: () => 1, clearTimer: () => {} });
  const undo = createUndoRegistry({ setTimer: () => 1, clearTimer: () => {} });
  const coach = createCoach(memoryArea());
  const settings = createSettings(memoryArea());
  const quick = {
    mute: vi.fn(async (_s: string) => {}),
    unmute: vi.fn(async (_s: string) => {}),
    notInterested: vi.fn(async (_el: Element) => {}),
    ...(opts.withBlock || opts.block
      ? { block: opts.block ? vi.fn(opts.block) : vi.fn(async (_s: string) => {}) }
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
    backend,
    cache,
    settings,
    quick,
    target,
    openUrl,
    membershipStore: opts.membershipStore,
    currentOwner: opts.currentOwner,
    anchorFor: opts.anchorFor,
    usage: opts.usage as Parameters<typeof createLassoController>[0]["usage"],
    assignOpts: { sleep: async () => {}, delayMs: 0 },
    ...(opts.omitNow ? {} : { now: () => Date.UTC(2026, 5, 10) }),
  });
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
    expect(h.picker.status.value).toBe("ready");
  });

  it("with no target shows the nudge toast instead of console noise", () => {
    const h = harness({ targetAuthor: null });
    h.controller.command("add-to-list");
    expect(titles(h)).toEqual(["Hover a post first — or press j to focus one"]);
  });
});

describe("the assign run (story beats 4 & 7)", () => {
  it("happy path: progress, success toast with View List + Undo, selection cleared", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(h.backend.added).toEqual(["a", "b"]);
    expect(h.selection.count.value).toBe(0);
    expect(h.app.running.value).toBeNull();
    const toast = h.toasts.toasts.value[0];
    expect(toast?.title).toBe("Added 2 to Design Folks");
    expect(toast?.actions?.map((a) => a.label)).toEqual(["View List", "Undo"]);
  });

  it("View List opens the List on X", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    const id = h.toasts.toasts.value[0]?.id as number;
    h.toasts.act(id, 0);
    expect(h.openUrl).toHaveBeenCalledWith("https://x.com/i/lists/L1");
  });

  it("Z undoes only what was just added, then confirms", async () => {
    const h = harness();
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a", "b"]);
    expect(titles(h)).toContain("Removed 2 from Design Folks");
  });

  it("z with nothing armed is left for X", () => {
    const h = harness();
    expect(h.controller.command("undo")).toBe(false);
  });

  it("rate limit mid-run: persistent danger toast, remaining people stay selected", async () => {
    const h = harness();
    h.backend.addImpl = async (au) => {
      if (au.screenName === "c") {
        throw new XApiError("rate-limited", "429", { resetAt: Date.UTC(2026, 5, 10) / 1000 + 720 });
      }
    };
    for (const s of ["a", "b", "c", "d", "e"]) h.selection.add({ screenName: s });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(titles(h)).toContain("2 added · 5 still selected");
    expect(h.selection.count.value).toBe(5);
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(h.selection.isSelected("bad")).toBe(true);
    const danger = h.toasts.toasts.value.find((t) => t.kind === "danger");
    const retry = danger?.actions?.find((a) => a.label === "Retry");
    retry?.run();
    h.toasts.dismiss(danger?.id as number);
    await flush();
    expect(h.backend.added).toEqual(["ok", "bad", "bad"]);
  });
});

describe("Alt+Shift+L — the graduation chord (story beat 6)", () => {
  it("adds the hovered author straight to the default List, no picker", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "L1" });
    await h.controller.addToDefaultList();
    expect(h.backend.added).toEqual(["jane"]);
    expect(h.app.pickerOpen.value).toBe(false);
    expect(titles(h)).toContain("Added 1 to Design Folks");
  });

  it("falls back to the picker when no default List is set", async () => {
    const h = harness();
    await h.controller.addToDefaultList();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
  });
});

describe("quick actions report back (story beat 6)", () => {
  it("mute: past-tense toast with Undo; Z unmutes", async () => {
    const h = harness();
    await h.controller.muteAuthor({ screenName: "jane" });
    expect(h.quick.mute).toHaveBeenCalledWith("jane");
    expect(titles(h)).toEqual(["Muted @jane"]);
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.quick.unmute).toHaveBeenCalledWith("jane");
  });

  it("mute failure: literal danger toast with Retry", async () => {
    const h = harness();
    h.quick.mute.mockRejectedValueOnce(new Error("boom"));
    await h.controller.muteAuthor({ screenName: "jane" });
    const toast = h.toasts.toasts.value[0];
    expect(toast?.kind).toBe("danger");
    expect(toast?.title).toBe("Couldn't mute @jane");
    expect(toast?.actions?.[0]?.label).toBe("Retry");
  });

  it("not-interested confirms that X received the feedback", async () => {
    const h = harness();
    await h.controller.hideTweet(document.createElement("article"));
    expect(titles(h)).toEqual(["Hidden — told X you're not interested"]);
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

  it("? toggles the shortcuts sheet", () => {
    const h = harness();
    expect(h.controller.command("help")).toBe(true);
    expect(h.app.shortcutsOpen.value).toBe(true);
    h.controller.command("help");
    expect(h.app.shortcutsOpen.value).toBe(false);
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
  const calls: Array<{ owner: Owner; list: XList; changes: MembershipChange[] }> = [];
  const store: MembershipStore = {
    recordAssign: async (o, l, c) => {
      calls.push({ owner: o, list: l, changes: c });
    },
    reconcileAuthor: async () => {},
    reconcileCatalog: async () => {},
    listsContaining: async () => [],
    catalog: async () => [],
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toEqual(owner);
    expect(calls[0]?.list.id).toBe("L1");
    expect(calls[0]?.changes).toEqual([
      { screenName: "a", userId: "7", action: "add", outcome: "added" },
      { screenName: "b", action: "add", outcome: "added" },
    ]);
  });

  it("skips the Mirror when no Owner is logged in (still assigns on X)", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => null });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
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
      reconcileCatalog: async () => {},
      listsContaining: async () => [],
      catalog: async () => [],
    };
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    h.selection.add({ screenName: "b" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
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

  it("mirrors undo removals as remove changes", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    h.controller.command("undo");
    await flush();
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes).toEqual([{ screenName: "a", action: "remove", outcome: "removed" }]);
  });

  it("a partial undo reports the real count and mirrors the failed remove", async () => {
    const { store, calls } = recordingStore();
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a", userId: "9" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    h.backend.removeMember = async () => {
      throw new Error("remove failed");
    };
    h.controller.command("undo");
    await flush();
    expect(titles(h)).toContain("Removed 0 from Design Folks");
    const removal = calls.find((c) => c.changes[0]?.action === "remove");
    expect(removal?.changes).toEqual([
      { screenName: "a", userId: "9", action: "remove", outcome: "failed" },
    ]);
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(calls).toEqual([]); // recordToMirror short-circuits on the empty change set
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
    await h.settings.set({ defaultListId: "L1" });
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
    await h.controller.muteAuthor({ screenName: "jane" });
    const id = h.toasts.toasts.value[0]?.id as number;
    h.toasts.act(id, 0); // the Undo action
    await flush();
    expect(h.quick.unmute).toHaveBeenCalledWith("jane");
  });

  it("mute failure Retry re-attempts the mute", async () => {
    const h = harness();
    h.quick.mute.mockRejectedValueOnce(new Error("boom"));
    await h.controller.muteAuthor({ screenName: "jane" });
    const danger = h.toasts.toasts.value[0];
    expect(danger?.kind).toBe("danger");
    danger?.actions?.[0]?.run(); // Retry
    await flush();
    expect(h.quick.mute).toHaveBeenCalledTimes(2);
  });

  it("a failing unmute reports the literal failure copy", async () => {
    const h = harness();
    h.quick.unmute.mockRejectedValueOnce(new Error("boom"));
    await h.controller.muteAuthor({ screenName: "jane" });
    h.controller.command("undo");
    await flush();
    expect(titles(h)).toContain("Couldn't mute @jane");
  });

  it("hide failure: literal danger toast with a working Retry", async () => {
    const h = harness();
    h.quick.notInterested.mockRejectedValueOnce(new Error("boom"));
    const el = document.createElement("article");
    await h.controller.hideTweet(el);
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    const toast = h.toasts.toasts.value[0];
    const undoAction = toast?.actions?.find((a) => a.label === "Undo");
    undoAction?.run();
    await flush();
    expect(h.backend.removed).toEqual(["a"]);
  });

  it("an empty selection is a no-op assign", async () => {
    const h = harness();
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(h.backend.added).toEqual([]);
    expect(h.app.running.value).toBeNull();
    expect(titles(h)).toEqual([]);
  });

  it("default list set but cache throws: falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "L1" });
    h.cache.lists = async () => {
      throw new Error("offline");
    };
    await h.controller.addToDefaultList();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("default list set but the id is missing from the cache: falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "does-not-exist" });
    await h.controller.addToDefaultList();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("addToDefaultList nudges when there is no focused author", async () => {
    const h = harness({ targetAuthor: null });
    await h.controller.addToDefaultList();
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
    const h = harness({ targetTweet: null, anchorFor: () => ({ left: 1, top: 1 }) });
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    expect(h.backend.added).toEqual(["a"]);
    expect(h.toasts.toasts.value[0]?.title).toBe("Added 1 to Design Folks");
  });
});
