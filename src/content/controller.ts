import type { AppState } from "@/content/app-state";
import type { CommandId } from "@/content/keyboard";
import { type AssignOptions, assignAuthorsToList } from "@/core/actions/assign-to-list";
import { feedbackFor } from "@/core/assign-feedback";
import type { Coach } from "@/core/coach";
import type { FilterStore } from "@/core/filter-store";
import type { ListCache } from "@/core/list-cache";
import type { ListUsage } from "@/core/list-usage";
import { NullMembershipStore } from "@/core/membership-store/null";
import type { MembershipChange, MembershipStore, Owner } from "@/core/membership-store/types";
import type { MirrorStatus } from "@/core/mirror-status";
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
import type { ToastAction, ToastSpec, ToastStore } from "@/core/toast-store";
import type { UndoRegistry } from "@/core/undo";
import type { XList, XListApi } from "@/core/x-client/types";

/** Mute/assign undo window (story beat 6: "Z, 10s window"). */
export const UNDO_WINDOW_MS = 10_000;

export type AssignSource = "pointer" | "keyboard";

export interface QuickActions {
  mute(screenName: string): Promise<void>;
  unmute(screenName: string): Promise<void>;
  /** "hidden" on success, "unavailable" when X offers no "not interested" here (silent no-op). */
  notInterested(tweetEl: Element): Promise<"hidden" | "unavailable">;
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
  /**
   * Observability hook for the Mirror: called after every recordAssign attempt with
   * its outcome, so a surface (popup) can show "synced/failing" instantly instead of
   * the user inferring it from a once-only console.warn. Fire-and-forget like the
   * write itself — never load-bearing (ADR-0009).
   */
  onMirrorResult?: (result: MirrorStatus) => void;
  usage?: ListUsage;
  /** The one global filter store; absent ⇒ filter commands are no-ops (ADR-0010 — never load-bearing). */
  filter?: FilterStore;
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
  /**
   * Conduct one in-page Filter command (cycle a criterion, reveal, show-all, …)
   * behind a fail-open wall: a throwing command is swallowed so a filter failure
   * can never break or alter the assign/undo flow (ADR-0010 — the Filter is never
   * load-bearing). No-op when no filter store is wired.
   */
  filterCommand(run: (filter: FilterStore) => void): void;
  openPicker(source?: AssignSource): void;
  assignSelectedTo(list: XList): Promise<void>;
  stopRun(): void;
  toggleSelect(author: TweetAuthor): void;
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
  const filter = deps.filter;
  let stopRequested = false;
  let lastSource: AssignSource = "pointer";
  let individualSelections = 0; // session-scoped, feeds the select-mode nudge
  let mirrorWarned = false; // C1: first Mirror failure is surfaced once, then silent

  const nudge = (): void => {
    toasts.show({ kind: "info", title: NO_TARGET_NUDGE });
  };

  /**
   * Mirror the changes from a run, stamped with the Owner logged in right now.
   * Fire-and-forget: the Mirror is off-to-the-side and must never block or break
   * the X flow — no Owner skips it, and a failure is swallowed (ADR-0009). The
   * try/catch also absorbs a *synchronous* throw from the seam (.catch alone only
   * attaches to a returned promise), and the first failure is surfaced once
   * so a silently-blocked Mirror — e.g. a page-CSP-rejected POST — is observable.
   */
  function recordToMirror(list: XList, changes: MembershipChange[]): void {
    if (changes.length === 0) return;
    const owner = currentOwner();
    if (!owner) return;
    const onFail = (err: unknown): void => {
      deps.onMirrorResult?.({ ok: false, at: now() });
      if (mirrorWarned) return;
      mirrorWarned = true;
      console.warn("[Lasso] Mirror write failed (off-to-the-side; X flow unaffected)", err);
    };
    try {
      void membershipStore
        .recordAssign(owner, list, changes)
        .then(() => deps.onMirrorResult?.({ ok: true, at: now() }))
        .catch(onFail);
    } catch (err) {
      onFail(err);
    }
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

  interface QuickActionOptions<T> {
    attempt(): Promise<T>;
    /** Side effect run on success before the toast (e.g. arming an undo). */
    onOk?(result: T): void;
    /** null = stay fully silent (no success, no failure copy applies here). */
    successToast(result: T): ToastSpec | null;
    failTitle: string;
    /** Absent = the no-retry variant (danger toast with no actions). */
    retry?(): void;
  }

  /** Shared try/catch → toast → undo-or-retry shape behind mute/unmute/block/hide. */
  async function quickAction<T>(opts: QuickActionOptions<T>): Promise<void> {
    try {
      const result = await opts.attempt();
      opts.onOk?.(result);
      const toast = opts.successToast(result);
      if (toast) toasts.show(toast);
    } catch {
      toasts.show({
        kind: "danger",
        title: opts.failTitle,
        ...(opts.retry ? { actions: [{ label: RETRY, run: opts.retry }] } : {}),
      });
    }
  }

  function muteAuthor(author: TweetAuthor): Promise<void> {
    return quickAction({
      attempt: () => quick.mute(author.screenName),
      onOk: () => undo.arm(() => void unmuteAuthor(author), UNDO_WINDOW_MS),
      successToast: () => ({
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
      }),
      failTitle: muteFailedLine(author.screenName),
      retry: () => void muteAuthor(author),
    });
  }

  function unmuteAuthor(author: TweetAuthor): Promise<void> {
    return quickAction({
      attempt: () => quick.unmute(author.screenName),
      successToast: () => ({ kind: "info", title: unmutedLine(author.screenName) }),
      failTitle: muteFailedLine(author.screenName),
    });
  }

  function blockAuthor(author: TweetAuthor): Promise<void> {
    const block = quick.block;
    if (!block) return Promise.resolve();
    return quickAction({
      attempt: () => block(author.screenName),
      successToast: () => ({ kind: "success", title: blockedLine(author.screenName) }),
      failTitle: blockFailedLine(author.screenName),
      retry: () => void blockAuthor(author),
    });
  }

  function hideTweet(tweetEl: Element): Promise<void> {
    return quickAction({
      attempt: () => quick.notInterested(tweetEl),
      // "unavailable" = X offers no "not interested" for this post (off the home feed):
      // stay fully silent — no toast, no Retry — instead of a futile failure.
      successToast: (result) =>
        result === "unavailable" ? null : { kind: "success", title: HIDDEN_LINE },
      failTitle: hideFailedLine,
      retry: () => void hideTweet(tweetEl),
    });
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

  /**
   * The walled Filter section. Every filter command runs fail-open and assign
   * never awaits one, so the Filter stays non-load-bearing even though a single
   * conductor now runs both capabilities (ADR-0010). A thrown filter command is
   * swallowed here and cannot reach the X flow's shared state (undo/toasts/selection).
   */
  function filterCommand(run: (filter: FilterStore) => void): void {
    if (!filter) return;
    const before = filter.state.value;
    try {
      run(filter);
    } catch {
      // A broken filter command must never touch the X flow.
      return;
    }
    // Arm undo only when the command changed persistent config — a transient
    // reveal / no-op must not shadow a more useful prior undo. One armed undo,
    // Z, last-wins, shared with the assign flow (the Filter stays non-load-bearing).
    if (filter.state.value !== before) {
      undo.arm(() => filter.restore(before), UNDO_WINDOW_MS);
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
      // The two filter keys return false when no filter store is wired, so the
      // bare keys fall through to X untouched (ADR-0010 — never load-bearing).
      case "toggle-filter": {
        if (!filter) return false;
        filterCommand((f) => f.setEnabled(!f.state.value.enabled));
        return true;
      }
      case "toggle-reveal": {
        if (!filter) return false;
        filterCommand((f) => f.setRevealed(!f.revealed.value));
        return true;
      }
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
    filterCommand,
    openPicker,
    assignSelectedTo,
    stopRun() {
      stopRequested = true;
    },
    toggleSelect,
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
