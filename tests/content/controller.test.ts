import { describe, expect, it, vi } from "vitest";

import { createAppState } from "@/content/app-state";
import { createLassoController, UNDO_WINDOW_MS } from "@/content/controller";
import { createCoach } from "@/core/coach";
import { createFilterStore, type FilterStore } from "@/core/filter-store";
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
    filter?: FilterStore;
    onMirrorResult?: (result: { ok: boolean; at: number }) => void;
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
    notInterested: vi.fn(async (_el: Element): Promise<"hidden" | "unavailable"> => "hidden"),
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
    onMirrorResult: opts.onMirrorResult,
    anchorFor: opts.anchorFor,
    usage: opts.usage as Parameters<typeof createLassoController>[0]["usage"],
    filter: opts.filter,
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

  it("a synchronously-throwing Mirror leaves the assign + undo flow intact and warns once (C3/C1)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: MembershipStore = {
      // NOT async — throws synchronously, before returning a promise .catch could attach to.
      recordAssign: () => {
        throw new Error("sync boom");
      },
      reconcileAuthor: async () => {},
      reconcileCatalog: async () => {},
      listsContaining: async () => [],
      catalog: async () => [],
    };
    const h = harness({ membershipStore: store, currentOwner: () => owner });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList); // recordToMirror #1 (sync throw)
    await flush();
    expect(h.backend.added).toEqual(["a"]); // X flow unaffected by the sync throw
    expect(h.controller.command("undo")).toBe(true);
    await flush();
    expect(h.backend.removed).toEqual(["a"]); // undo path #2 also survives
    expect(warn).toHaveBeenCalledTimes(1); // one-time: the second failure is silent
    warn.mockRestore();
  });

  it("a throwing Owner read (malformed twid cookie) leaves the assign flow intact and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, calls } = recordingStore();
    const results: boolean[] = [];
    const h = harness({
      membershipStore: store,
      currentOwner: () => {
        throw new URIError("URI malformed"); // decodeURIComponent on a corrupt cookie
      },
      onMirrorResult: (r) => void results.push(r.ok),
    });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(h.backend.added).toEqual(["a"]); // X flow unaffected
    expect(calls.length).toBe(0); // nothing recorded without an Owner
    expect(results).toEqual([false]); // surfaced as a Mirror failure
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
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

  it("reports a settled Mirror write via onMirrorResult (popup's instant status row)", async () => {
    const { store } = recordingStore();
    const onMirrorResult = vi.fn();
    const h = harness({ membershipStore: store, currentOwner: () => owner, onMirrorResult });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledWith({ ok: true, at: Date.UTC(2026, 5, 10) });
  });

  it("reports async and sync Mirror failures via onMirrorResult", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onMirrorResult = vi.fn();
    const asyncFail: MembershipStore = {
      recordAssign: async () => {
        throw new Error("convex down");
      },
      reconcileAuthor: async () => {},
      reconcileCatalog: async () => {},
      listsContaining: async () => [],
      catalog: async () => [],
    };
    const h = harness({ membershipStore: asyncFail, currentOwner: () => owner, onMirrorResult });
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledWith({ ok: false, at: Date.UTC(2026, 5, 10) });

    const syncFail: MembershipStore = {
      ...asyncFail,
      recordAssign: () => {
        throw new Error("sync boom");
      },
    };
    const h2 = harness({ membershipStore: syncFail, currentOwner: () => owner, onMirrorResult });
    h2.selection.add({ screenName: "b" });
    await h2.controller.assignSelectedTo(LISTS[0] as XList);
    await flush();
    expect(onMirrorResult).toHaveBeenCalledTimes(2);
    expect(onMirrorResult).toHaveBeenLastCalledWith({ ok: false, at: Date.UTC(2026, 5, 10) });
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
    await h.controller.assignSelectedTo(LISTS[0] as XList);
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
    expect(filter.state.value.criteria).toEqual({ "kind:video": "hide", "kind:link": "only" });
    expect(h.controller.command("undo")).toBe(true); // one Z
    expect(filter.state.value.criteria).toEqual({}); // the whole batch reverted in one entry
  });

  it("undo is last-wins across filter and assign: a later assign owns Z", async () => {
    const filter = createFilterStore({ navLanguages: ["en"] });
    const h = harness({ filter });
    h.controller.filterCommand((s) => s.cycle("kind:video")); // arms a filter undo
    h.selection.add({ screenName: "a" });
    await h.controller.assignSelectedTo(LISTS[0] as XList); // arms the assign undo (replaces)
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
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
  });

  it("default list set but the id is missing from the cache: falls back to the picker", async () => {
    const h = harness();
    await h.settings.set({ defaultListId: "does-not-exist" });
    h.controller.command("add-to-default-list");
    await flush();
    expect(h.backend.added).toEqual([]);
    expect(h.app.pickerOpen.value).toBe(true);
    expect(h.selection.isSelected("jane")).toBe(true);
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
