import type { AppState } from "@/content/app-state";
import type { CommandId } from "@/content/keyboard";
import { type AssignOptions, assignAuthorsToList } from "@/core/actions/assign-to-list";
import { feedbackFor } from "@/core/assign-feedback";
import type { Coach } from "@/core/coach";
import type { ListCache } from "@/core/list-cache";
import type { ListUsage } from "@/core/list-usage";
import { NullMembershipStore } from "@/core/membership-store/null";
import type { MembershipChange, MembershipStore, Owner } from "@/core/membership-store/types";
import type { PickerController } from "@/core/picker-controller";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import type { SettingsStore } from "@/core/settings";
import {
  blockedLine,
  blockFailedLine,
  HIDDEN_LINE,
  hideFailedLine,
  mutedLine,
  muteFailedLine,
  NO_TARGET_NUDGE,
  POST_ASSIGN_TIP,
  removedLine,
  RETRY,
  SELECT_MODE_NUDGE,
  SELECTOR_HEALTH,
  UNDO,
  unmutedLine,
  VIEW_LIST,
  WAKE_TOAST,
} from "@/core/strings";
import type { ToastAction, ToastStore } from "@/core/toast-store";
import type { UndoRegistry } from "@/core/undo";
import type { XList, XListApi } from "@/core/x-client/types";

/** Mute/assign undo window (story beat 6: "Z, 10s window"). */
export const UNDO_WINDOW_MS = 10_000;

export type AssignSource = "pointer" | "keyboard";

export interface QuickActions {
  mute(screenName: string): Promise<void>;
  unmute(screenName: string): Promise<void>;
  notInterested(tweetEl: Element): Promise<void>;
  block?(screenName: string): Promise<void>;
}

export interface TargetResolver {
  /** Author of the hovered (fallback: j/k-focused) post. */
  author(): TweetAuthor | null;
  tweet(): Element | null;
}

export interface PickerAnchorResolver {
  /** Viewport position at the post's caret corner, where X's own "…" menu opens. */
  (tweetEl: Element): { left: number; top: number } | null;
}

export interface ControllerDeps {
  selection: SelectionStore;
  app: AppState;
  picker: PickerController;
  toasts: ToastStore;
  undo: UndoRegistry;
  coach: Coach;
  backend: XListApi;
  cache: ListCache;
  settings: SettingsStore;
  /** Off-to-the-side Mirror (ADR-0009); absent ⇒ NullMembershipStore ⇒ X flow unchanged. */
  membershipStore?: MembershipStore;
  /** The Owner logged in at action time; absent/returns null ⇒ the Mirror is skipped. */
  currentOwner?: () => Owner | null;
  usage?: ListUsage;
  quick: QuickActions;
  target: TargetResolver;
  openUrl(url: string): void;
  /** Caret-anchoring for keyboard-driven opens (story beat 6). */
  anchorFor?: PickerAnchorResolver;
  assignOpts?: AssignOptions;
  now?: () => number;
}

/**
 * The conductor: maps keyboard commands and UI gestures onto the product
 * story's flows — assign runs with progress/Stop, designed failure toasts,
 * Undo scoped to what was just added, quick actions that report back, and the
 * coaching tips that decay. Headless and fully unit-tested; main.tsx only wires
 * DOM events into it.
 */
export interface LassoController {
  /** Sync command entry for the keyboard layer; false = not consumed, leave for X. */
  command(cmd: CommandId): boolean;
  openPicker(source?: AssignSource): void;
  assignSelectedTo(list: XList): Promise<void>;
  addToDefaultList(): Promise<void>;
  stopRun(): void;
  toggleSelect(author: TweetAuthor): void;
  muteAuthor(author: TweetAuthor): Promise<void>;
  hideTweet(tweetEl: Element): Promise<void>;
  trySelectMode(): void;
  skipWelcome(): void;
  wake(): void;
  reportBreakage(): void;
}

export function createLassoController(deps: ControllerDeps): LassoController {
  const { selection, app, picker, toasts, undo, coach, backend, cache, settings, quick, target } =
    deps;
  const now = deps.now ?? Date.now;
  const membershipStore = deps.membershipStore ?? new NullMembershipStore();
  const currentOwner = deps.currentOwner ?? ((): Owner | null => null);
  let stopRequested = false;
  let lastSource: AssignSource = "pointer";
  let individualSelections = 0; // session-scoped, feeds the select-mode nudge

  const nudge = (): void => {
    toasts.show({ kind: "info", title: NO_TARGET_NUDGE });
  };

  /**
   * Mirror the changes from a run, stamped with the Owner logged in right now.
   * Fire-and-forget: the Mirror is off-to-the-side and must never block or break
   * the X flow — no Owner skips it, and a failure is swallowed (ADR-0009).
   */
  function recordToMirror(list: XList, changes: MembershipChange[]): void {
    if (changes.length === 0) return;
    const owner = currentOwner();
    if (!owner) return;
    void membershipStore.recordAssign(owner, list, changes).catch(() => {});
  }

  function openPicker(source: AssignSource = "pointer"): void {
    lastSource = source;
    const tweet = source === "keyboard" ? target.tweet() : null;
    app.pickerAnchor.value = tweet ? (deps.anchorFor?.(tweet) ?? null) : null;
    app.pickerOpen.value = true;
    void picker.open(selection.list());
  }

  async function undoAdds(authors: TweetAuthor[], list: XList): Promise<void> {
    let n = 0;
    const changes: MembershipChange[] = [];
    for (const author of authors) {
      const base: MembershipChange = {
        screenName: author.screenName,
        ...(author.userId !== undefined ? { userId: author.userId } : {}),
        action: "remove",
        outcome: "removed",
      };
      try {
        await backend.removeMember(list, author);
        n++;
        changes.push(base);
      } catch {
        // partial undo still gets reported with the real count
        changes.push({ ...base, outcome: "failed" });
      }
    }
    recordToMirror(list, changes);
    toasts.show({ kind: "info", title: removedLine(n, list.name) });
  }

  async function runAssign(
    authors: TweetAuthor[],
    list: XList,
    source: AssignSource,
  ): Promise<void> {
    if (authors.length === 0) return;
    app.pickerOpen.value = false;
    app.reviewOpen.value = false;
    stopRequested = false;
    void deps.usage?.record(list.id);

    app.running.value = { current: 0, total: authors.length, listName: list.name };
    const results = await assignAuthorsToList(authors, list, backend, {
      ...deps.assignOpts,
      onProgress: (current, total) => {
        app.running.value = { current, total, listName: list.name };
      },
      shouldStop: () => stopRequested,
    });
    app.running.value = null;

    recordToMirror(
      list,
      results.map((r) => ({
        screenName: r.author.screenName,
        ...(r.author.userId !== undefined ? { userId: r.author.userId } : {}),
        action: "add" as const,
        outcome: r.outcome,
      })),
    );

    const stopped = stopRequested && results.length < authors.length;
    const fb = feedbackFor(results, list, { selectedCount: authors.length, stopped, nowMs: now() });
    for (const screenName of fb.deselect) selection.remove(screenName);
    void coach.recordAssign();

    if (fb.actions.includes("undo") && fb.undoable.length > 0) {
      undo.arm(() => void undoAdds(fb.undoable, list), UNDO_WINDOW_MS);
    }
    const actions: ToastAction[] = fb.actions.map((kind) => {
      if (kind === "view-list") {
        return { label: VIEW_LIST, run: () => deps.openUrl(`https://x.com/i/lists/${list.id}`) };
      }
      if (kind === "undo") {
        return {
          label: UNDO,
          kbd: "Z",
          run: () => {
            undo.trigger();
          },
        };
      }
      return { label: RETRY, run: () => void assignSelectedTo(list) };
    });
    toasts.show({ ...fb.toast, actions });

    if (
      source === "pointer" &&
      fb.toast.kind === "success" &&
      (await coach.tryShowTip("post-assign"))
    ) {
      toasts.show({ kind: "info", title: POST_ASSIGN_TIP });
    }
  }

  function assignSelectedTo(list: XList): Promise<void> {
    return runAssign(selection.list(), list, lastSource);
  }

  async function addToDefaultList(): Promise<void> {
    const author = target.author();
    if (!author) {
      nudge();
      return;
    }
    const { defaultListId } = await settings.get();
    const lists = defaultListId ? await cache.lists().catch((): XList[] => []) : [];
    const list = lists.find((l) => l.id === defaultListId);
    if (!list) {
      selection.add(author);
      openPicker("keyboard");
      return;
    }
    await runAssign([author], list, "keyboard");
  }

  async function muteAuthor(author: TweetAuthor): Promise<void> {
    try {
      await quick.mute(author.screenName);
      undo.arm(() => void unmuteAuthor(author), UNDO_WINDOW_MS);
      toasts.show({
        kind: "success",
        title: mutedLine(author.screenName),
        durationMs: UNDO_WINDOW_MS,
        actions: [
          {
            label: UNDO,
            kbd: "Z",
            run: () => {
              undo.trigger();
            },
          },
        ],
      });
    } catch {
      toasts.show({
        kind: "danger",
        title: muteFailedLine(author.screenName),
        actions: [{ label: RETRY, run: () => void muteAuthor(author) }],
      });
    }
  }

  async function unmuteAuthor(author: TweetAuthor): Promise<void> {
    try {
      await quick.unmute(author.screenName);
      toasts.show({ kind: "info", title: unmutedLine(author.screenName) });
    } catch {
      toasts.show({ kind: "danger", title: muteFailedLine(author.screenName) });
    }
  }

  async function blockAuthor(author: TweetAuthor): Promise<void> {
    if (!quick.block) return;
    try {
      await quick.block(author.screenName);
      toasts.show({ kind: "success", title: blockedLine(author.screenName) });
    } catch {
      toasts.show({
        kind: "danger",
        title: blockFailedLine(author.screenName),
        actions: [{ label: RETRY, run: () => void blockAuthor(author) }],
      });
    }
  }

  async function hideTweet(tweetEl: Element): Promise<void> {
    try {
      await quick.notInterested(tweetEl);
      toasts.show({ kind: "success", title: HIDDEN_LINE });
    } catch {
      toasts.show({
        kind: "danger",
        title: hideFailedLine,
        actions: [{ label: RETRY, run: () => void hideTweet(tweetEl) }],
      });
    }
  }

  function toggleSelect(author: TweetAuthor): void {
    const wasSelected = selection.isSelected(author.screenName);
    selection.toggle(author);
    if (!wasSelected && !selection.selectMode.value) {
      individualSelections++;
      if (individualSelections === 3) {
        void coach.tryShowTip("select-nudge").then((show) => {
          if (show) toasts.show({ kind: "info", title: SELECT_MODE_NUDGE });
        });
      }
    }
  }

  function command(cmd: CommandId): boolean {
    switch (cmd) {
      case "escape":
        return app.handleEscape();
      case "undo":
        return undo.trigger();
      case "help":
        app.shortcutsOpen.value = !app.shortcutsOpen.value;
        return true;
      case "toggle-select-mode":
        selection.setSelectMode(!selection.selectMode.value);
        return true;
      case "toggle-select": {
        const author = target.author();
        if (author) toggleSelect(author);
        else nudge();
        return true;
      }
      case "add-to-list": {
        if (selection.count.value > 0) {
          openPicker("keyboard");
          return true;
        }
        const author = target.author();
        if (!author) {
          nudge();
          return true;
        }
        selection.add(author);
        openPicker("keyboard");
        return true;
      }
      case "add-to-default-list":
        void addToDefaultList();
        return true;
      case "mute": {
        const author = target.author();
        if (author) void muteAuthor(author);
        else nudge();
        return true;
      }
      case "block": {
        const author = target.author();
        if (author) void blockAuthor(author);
        else nudge();
        return true;
      }
      case "not-interested": {
        const tweet = target.tweet();
        if (tweet) void hideTweet(tweet);
        else nudge();
        return true;
      }
    }
  }

  return {
    command,
    openPicker,
    assignSelectedTo,
    addToDefaultList,
    stopRun() {
      stopRequested = true;
    },
    toggleSelect,
    muteAuthor,
    hideTweet,
    trySelectMode() {
      selection.setSelectMode(true);
      app.welcomeOpen.value = false;
      void coach.markOnboarded();
    },
    skipWelcome() {
      app.welcomeOpen.value = false;
      void coach.markOnboarded();
    },
    wake() {
      toasts.show({ kind: "info", title: WAKE_TOAST });
    },
    reportBreakage() {
      toasts.show({ kind: "info", title: SELECTOR_HEALTH, durationMs: 8000 });
    },
  };
}
