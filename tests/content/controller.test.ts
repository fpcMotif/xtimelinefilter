import { describe, expect, it, vi } from "vitest";

import { createAppState } from "@/content/app-state";
import { createLassoController, UNDO_WINDOW_MS } from "@/content/controller";
import { createCoach } from "@/core/coach";
import type { ListCache } from "@/core/list-cache";
import { createPickerController } from "@/core/picker-controller";
import type { MembershipChange, MembershipStore, Owner } from "@/core/membership-store/types";
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
    lists?: XList[];
    membershipStore?: MembershipStore;
    currentOwner?: () => Owner | null;
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
  };
  const openUrl = vi.fn();
  const target = {
    author: () => (opts.targetAuthor === undefined ? { screenName: "jane" } : opts.targetAuthor),
    tweet: () => document.createElement("article"),
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
    assignOpts: { sleep: async () => {}, delayMs: 0 },
    now: () => Date.UTC(2026, 5, 10),
  });
  return {
    selection,
    app,
    backend,
    picker,
    toasts,
    undo,
    coach,
    settings,
    quick,
    openUrl,
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
});
