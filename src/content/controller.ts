import type { AppState } from "@/content/app-state";
import type { CollectionsClient } from "@/content/collections-client";
import type { CommandId } from "@/content/keyboard";
import { outermostTweet } from "@/content/outermost-tweet";
import {
  type AssignOptions,
  assignAuthorsToList,
  removeAuthorsFromList,
} from "@/core/actions/assign-to-list";
import { feedbackFor } from "@/core/assign-feedback";
import type { Coach } from "@/core/coach";
import type { FilterStore } from "@/core/filter-store";
import type { FolderPickerController, FolderPickerEffect } from "@/core/folder-picker-controller";
import type { ListCache } from "@/core/list-cache";
import type { ListUsage } from "@/core/list-usage";
import type { PickerController, PickerEffect } from "@/core/picker-controller";
import type { SelectionStore, TweetAuthor } from "@/core/selection-store";
import type { SettingsStore } from "@/core/settings";
import {
  alreadyInFolderLine,
  blockedLine,
  blockFailedLine,
  HIDDEN_LINE,
  hideFailedLine,
  mutedLine,
  muteFailedLine,
  CANNOT_SAVE_POST,
  NO_DEFAULT_FOLDER,
  NO_TARGET_NUDGE,
  POST_ASSIGN_TIP,
  removedLine,
  RETRY,
  SAVE_FAILED,
  savedToFolderLine,
  SELECT_MODE_NUDGE,
  SELECTOR_HEALTH,
  UNDO,
  unmutedLine,
  VIEW_LIST,
  WAKE_TOAST,
} from "@/core/strings";
import type { ToastAction, ToastSpec, ToastStore } from "@/core/toast-store";
import { UNDO_WINDOW_MS, type UndoRegistry } from "@/core/undo";
import type { PostCapture, SaveOutcome } from "@/packages/folders/types";
import { membershipIdentityOf, NullMembershipStore } from "@/packages/membership-store";
import type { MembershipChange, MembershipStore, Owner } from "@/packages/membership-store/types";
import { capture } from "@/packages/tweet-read";
import type { XList, XListApi, XListApiSource } from "@/packages/x-client/types";

export { UNDO_WINDOW_MS };

const ownsTarget = (targetOwner: Owner | null, actingOwner: Owner | null): boolean =>
  targetOwner ? actingOwner?.userId === targetOwner.userId : actingOwner === null;

/** Optional side effects must not alter X's result or leak a rejected promise. */
const fireAndForget = (operation: () => Promise<unknown>): void => {
  try {
    void operation().catch(() => {});
  } catch {
    // A seam may throw before returning its promise.
  }
};

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
  backend: XListApiSource;
  cache: ListCache;
  settings: SettingsStore;
  /** Off-to-the-side Mirror (ADR-0009); absent ⇒ NullMembershipStore ⇒ X flow unchanged. */
  membershipStore?: MembershipStore;
  /** The Owner logged in at action time; absent/returns null ⇒ the Mirror is skipped. */
  currentOwner?: () => Owner | null;
  /** Opaque identity of the Mirror configured at dispatch time. */
  mirrorConfigurationId?: () => string | null;
  /**
   * Observability hook for the Mirror: called after every recordAssign attempt with
   * its outcome, so a surface (popup) can show "synced/failing" instantly instead of
   * the user inferring it from a once-only console.warn. Fire-and-forget like the
   * write itself — never load-bearing (ADR-0009).
   */
  onMirrorResult?: (result: { ok: boolean; configId: string }) => void | Promise<void>;
  usage?: ListUsage;
  /** Folders. Absent ⇒ the save gesture reports that it cannot save. */
  collections?: CollectionsClient;
  /** Folder Picker controller; absent ⇒ Alt+B nudges. */
  folderPicker?: FolderPickerController;
  /** The one global filter store; absent ⇒ filter commands are no-ops (ADR-0010 — never load-bearing). */
  filter?: FilterStore;
  /** Filter commands only operate on supported timeline routes. */
  filterInScope?: () => boolean;
  quick: QuickActions;
  target: TargetResolver;
  openUrl(url: string): void;
  /** Caret-anchoring for keyboard-driven opens (story beat 6). */
  anchorFor?: PickerAnchorResolver;
  /** Platform-specific durable reader; X's Tweet capture remains the default. */
  capturePost?: (article: Element) => PostCapture;
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
  /** Runs only a Picker-approved assignment. */
  pickerEffect(effect: Exclude<PickerEffect, null>): Promise<void>;
  /** Opens the Folder Picker with the captured post under the cursor / j/k focus. */
  openFolderPicker(): void;
  /**
   * Opens the Folder Picker for a concrete article (per-post overlay). Bypasses
   * hover/j-k target resolution so save works on thread pages where focus fails.
   */
  openFolderPickerForArticle(article: Element): void;
  /** Runs only a Folder Picker-approved save. */
  folderPickerEffect(effect: Exclude<FolderPickerEffect, null>): Promise<void>;
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
  const capturePost = deps.capturePost ?? capture;
  const membershipStore = deps.membershipStore ?? new NullMembershipStore();
  const currentOwner = deps.currentOwner ?? ((): Owner | null => null);
  const collections = deps.collections;
  const folderPicker = deps.folderPicker;
  const filter = deps.filter;
  const filterInScope = deps.filterInScope ?? (() => true);
  let stopRequested = false;
  let activeAssignment = false;
  let activeUndo = false;
  let lastSource: AssignSource = "pointer";
  let individualSelections = 0; // session-scoped, feeds the select-mode nudge
  let mirrorWarned = false; // C1: first Mirror failure is surfaced once, then silent

  const nudge = (): void => {
    toasts.show({ kind: "info", title: NO_TARGET_NUDGE });
  };

  /**
   * Mirror changes only after the caller confirms the target Owner is still active.
   * Fire-and-forget: the Mirror is off-to-the-side and must never block or break
   * the X flow — no Owner skips it, and a failure is swallowed (ADR-0009). The
   * try/catch also absorbs a *synchronous* throw from the seam (.catch alone only
   * attaches to a returned promise), and the first failure is surfaced once
   * so a silently-blocked Mirror — e.g. a page-CSP-rejected POST — is observable.
   */
  function recordToMirror(
    owner: Owner | null,
    ownerObservedAt: number,
    list: XList,
    changes: MembershipChange[],
  ): void {
    if (!owner || changes.length === 0) return;
    let configId: string | null = null;
    try {
      configId = deps.mirrorConfigurationId?.() ?? null;
    } catch {
      // Status identity is optional observability. The Mirror write still runs.
    }
    const report = (ok: boolean): void => {
      if (!configId) return;
      try {
        const result = deps.onMirrorResult?.({ ok, configId });
        void Promise.resolve(result).catch(() => {});
      } catch {
        // A status sink cannot alter the optional Mirror or X result.
      }
    };
    const onFail = (err: unknown): void => {
      report(false);
      if (mirrorWarned) return;
      mirrorWarned = true;
      console.warn("[Lasso] Mirror write failed (off-to-the-side; X flow unaffected)", err);
    };
    try {
      void membershipStore
        .recordAssign(owner, list, { changes, ownerObservedAt })
        .then(() => {
          report(true);
        })
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

  async function undoAdds(
    authors: TweetAuthor[],
    owner: Owner | null,
    list: XList,
    api: XListApi,
  ): Promise<void> {
    if (!ownsTarget(owner, currentOwner())) return;
    if (activeAssignment || activeUndo) return;
    activeUndo = true;
    try {
      const results = await removeAuthorsFromList(authors, list, api, {
        ...deps.assignOpts,
        now,
        shouldStop: () => !ownsTarget(owner, currentOwner()),
      });
      const changes: MembershipChange[] = results.map((r) => ({
        screenName: r.author.screenName,
        ...(r.author.userId !== undefined ? { userId: r.author.userId } : {}),
        identity: membershipIdentityOf(r.author),
        action: "remove",
        outcome: r.outcome,
        evidence: r.evidence,
        observedAt: r.observedAt,
      }));
      const n = results.filter((r) => r.outcome === "removed").length;
      const actingOwner = currentOwner();
      const ownerObservedAt = now();
      if (ownsTarget(owner, actingOwner)) {
        recordToMirror(actingOwner, ownerObservedAt, list, changes);
      }
      toasts.show({ kind: "info", title: removedLine(n, list.name) });
    } finally {
      activeUndo = false;
    }
  }

  async function runAssign(
    authors: TweetAuthor[],
    listTarget: { owner: Owner | null; list: XList },
    source: AssignSource,
  ): Promise<void> {
    if (authors.length === 0 || activeAssignment || activeUndo) return;
    activeAssignment = true;
    try {
      const actingOwner = currentOwner();
      if (!ownsTarget(listTarget.owner, actingOwner)) return;
      const { list } = listTarget;
      // One run is deliberately pinned to one adapter. A settings change takes
      // effect for the next user action, never halfway through this paced loop.
      const api = backend.snapshot();
      app.pickerOpen.value = false;
      app.reviewOpen.value = false;
      stopRequested = false;
      let ownerChanged = false;
      if (actingOwner && deps.usage)
        fireAndForget(() => deps.usage!.record(actingOwner.userId, list.id));

      app.running.value = {
        current: 0,
        total: authors.length,
        listName: list.name,
      };
      const results = await assignAuthorsToList(authors, list, api, {
        ...deps.assignOpts,
        now,
        onProgress: (current, total) => {
          app.running.value = { current, total, listName: list.name };
        },
        shouldStop: () => {
          if (!ownsTarget(listTarget.owner, currentOwner())) ownerChanged = true;
          return stopRequested || ownerChanged;
        },
      });

      const changes = results.map((r) => ({
        screenName: r.author.screenName,
        ...(r.author.userId !== undefined ? { userId: r.author.userId } : {}),
        identity: membershipIdentityOf(r.author),
        action: "add" as const,
        outcome: r.outcome,
        evidence: r.evidence,
        observedAt: r.observedAt,
      }));
      const mirrorOwner = currentOwner();
      const ownerObservedAt = now();
      if (!ownerChanged && ownsTarget(listTarget.owner, mirrorOwner)) {
        recordToMirror(mirrorOwner, ownerObservedAt, list, changes);
      }

      const stopped = results.length < authors.length && (stopRequested || ownerChanged);
      const fb = feedbackFor(results, list, {
        selectedCount: authors.length,
        stopped,
        nowMs: now(),
      });
      for (const screenName of fb.deselect) selection.remove(screenName);
      void coach.recordAssign();

      if (fb.actions.includes("undo") && fb.undoable.length > 0) {
        undo.arm(() => void undoAdds(fb.undoable, listTarget.owner, list, api), UNDO_WINDOW_MS);
      }
      const actions: ToastAction[] = fb.actions.map((kind) => {
        if (kind === "view-list") {
          return {
            label: VIEW_LIST,
            run: () => deps.openUrl(`https://x.com/i/lists/${list.id}`),
          };
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
        return {
          label: RETRY,
          run: () => void runAssign(selection.list(), listTarget, source),
        };
      });
      toasts.show({ ...fb.toast, actions });

      if (source === "pointer" && fb.toast.kind === "success") {
        // Coaching is cosmetic. Never hold the assignment lock—or reject the
        // completed X action—while its storage read settles.
        void coach
          .tryShowTip("post-assign")
          .then((show) => {
            if (show) toasts.show({ kind: "info", title: POST_ASSIGN_TIP });
          })
          .catch(() => {});
      }
    } finally {
      app.running.value = null;
      activeAssignment = false;
    }
  }

  async function pickerEffect(effect: Exclude<PickerEffect, null>): Promise<void> {
    await runAssign([...effect.authors], effect, lastSource);
  }

  /**
   * Open the Folder Picker for a concrete article (per-post overlay path). The
   * capture is taken synchronously (the timeline is virtualized) and handed to
   * the picker, which files it into the user's chosen Folder on confirm.
   */
  function openFolderPickerForArticle(article: Element): void {
    if (!folderPicker || !collections) {
      toasts.show({ kind: "danger", title: SAVE_FAILED });
      return;
    }
    const post = capturePost(outermostTweet(article) as Element);
    if (!post.statusId) {
      toasts.show({ kind: "danger", title: CANNOT_SAVE_POST });
      return;
    }
    app.pickerAnchor.value = deps.anchorFor?.(article) ?? null;
    app.folderPickerOpen.value = true;
    void folderPicker.open(post);
  }

  function openFolderPicker(): void {
    const tweet = target.tweet();
    if (!tweet) {
      nudge();
      return;
    }
    openFolderPickerForArticle(tweet);
  }

  async function folderPickerEffect(effect: Exclude<FolderPickerEffect, null>): Promise<void> {
    app.folderPickerOpen.value = false;
    await saveToFolder(effect.folderId, effect.folderName, effect.capture);
  }

  async function addToDefaultList(): Promise<void> {
    const author = target.author();
    if (!author) {
      nudge();
      return;
    }

    // A settings read only chooses the fast path. It must not make this
    // keyboard command fail or lose its target.
    let defaultList: Awaited<ReturnType<SettingsStore["get"]>>["defaultList"];
    let defaultListId: Awaited<ReturnType<SettingsStore["get"]>>["defaultListId"];
    try {
      ({ defaultList, defaultListId } = await settings.get());
    } catch {
      selection.add(author);
      openPicker("keyboard");
      return;
    }
    const owner = currentOwner();
    let defaultTarget = defaultList;
    let lists: XList[] = [];
    if (defaultTarget && owner && defaultTarget.ownerUserId === owner.userId) {
      lists = (await cache.cached(owner).catch((): null => null)) ?? [];
      if (!ownsTarget(owner, currentOwner())) {
        selection.add(author);
        openPicker("keyboard");
        return;
      }
    } else if (!defaultTarget && defaultListId && owner) {
      lists = await cache.refresh(owner).catch((): XList[] => []);
      if (!ownsTarget(owner, currentOwner())) {
        selection.add(author);
        openPicker("keyboard");
        return;
      }
      if (lists.some((candidate) => candidate.id === defaultListId)) {
        defaultTarget = { ownerUserId: owner.userId, listId: defaultListId };
        fireAndForget(() =>
          settings.set({
            defaultList: defaultTarget,
            defaultListId: undefined,
          }),
        );
      }
    }
    const list = lists.find((candidate) => candidate.id === defaultTarget?.listId);
    if (!list) {
      selection.add(author);
      openPicker("keyboard");
      return;
    }
    await runAssign([author], { owner: owner!, list }, "keyboard");
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

  /**
   * File the post under the cursor into the default Folder — the no-picker save.
   *
   * The capture is taken SYNCHRONOUSLY by the caller, before any round-trip: the
   * timeline is virtualized, so the article may be recycled while the worker
   * write is in flight and re-reading it afterwards could capture a different
   * post. The worker resolves the Folder inside one operation, so nothing here
   * reads settings or lists Folders first.
   */
  async function saveToDefaultFolder(post: PostCapture): Promise<void> {
    if (!post.statusId) {
      toasts.show({ kind: "danger", title: CANNOT_SAVE_POST });
      return;
    }
    const folders = collections;
    if (!folders) {
      toasts.show({ kind: "danger", title: SAVE_FAILED });
      return;
    }
    await quickAction({
      attempt: () => folders.saveToDefaultFolder(post),
      onOk: (outcome) => {
        // "Already there" wrote nothing, so arming Undo would evict whatever
        // useful Undo the user already had for something that reverses nothing.
        if (outcome.status !== "saved" || outcome.saved !== "created") return;
        undo.arm(
          () =>
            void folders.undoSave({
              folderId: outcome.folderId,
              statusId: outcome.statusId,
              createdSavedPost: outcome.createdSavedPost,
            }),
          UNDO_WINDOW_MS,
        );
      },
      successToast: (outcome) => {
        if (outcome.status === "unsavable") return { kind: "danger", title: CANNOT_SAVE_POST };
        if (outcome.status === "ask") return { kind: "info", title: NO_DEFAULT_FOLDER };
        if (outcome.saved === "already-there")
          return { kind: "info", title: alreadyInFolderLine(outcome.folderName) };
        return {
          kind: "success",
          title: savedToFolderLine(outcome.folderName),
          durationMs: UNDO_WINDOW_MS,
          actions: [{ label: UNDO, kbd: "Z", run: () => void undo.trigger() }],
        };
      },
      failTitle: SAVE_FAILED,
      retry: () => void saveToDefaultFolder(post),
    });
  }

  /**
   * File a captured post into a specific Folder (chosen by the Folder Picker).
   * Like the default-Folder save, the capture was taken synchronously at
   * keydown time. Undo unfills the post from this Folder only — the SavedPost
   * may also sit in other Folders.
   */
  async function saveToFolder(
    folderId: string,
    folderName: string,
    post: PostCapture,
  ): Promise<void> {
    if (!post.statusId) {
      toasts.show({ kind: "danger", title: CANNOT_SAVE_POST });
      return;
    }
    const folders = collections;
    if (!folders) {
      toasts.show({ kind: "danger", title: SAVE_FAILED });
      return;
    }
    const attempt = (): Promise<SaveOutcome & { createdSavedPost: boolean }> =>
      folders.saveToFolder(folderId, post);
    await quickAction({
      attempt,
      onOk: (outcome) => {
        if (outcome.status !== "saved") return;
        undo.arm(
          () =>
            void folders.undoSave({
              folderId,
              statusId: post.statusId!,
              createdSavedPost: outcome.createdSavedPost,
            }),
          UNDO_WINDOW_MS,
        );
      },
      successToast: (outcome) => {
        if (outcome.status === "unsavable") return { kind: "danger", title: CANNOT_SAVE_POST };
        if (outcome.status === "already-there")
          return { kind: "info", title: alreadyInFolderLine(folderName) };
        return {
          kind: "success",
          title: savedToFolderLine(folderName),
          durationMs: UNDO_WINDOW_MS,
          actions: [{ label: UNDO, kbd: "Z", run: () => void undo.trigger() }],
        };
      },
      failTitle: SAVE_FAILED,
      retry: () => void saveToFolder(folderId, folderName, post),
    });
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
      successToast: () => ({
        kind: "info",
        title: unmutedLine(author.screenName),
      }),
      failTitle: muteFailedLine(author.screenName),
    });
  }

  function blockAuthor(author: TweetAuthor): Promise<void> {
    const block = quick.block;
    if (!block) return Promise.resolve();
    return quickAction({
      attempt: () => block(author.screenName),
      successToast: () => ({
        kind: "success",
        title: blockedLine(author.screenName),
      }),
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
    if (activeAssignment) return;
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
    if (!filter || !filterInScope()) return;
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
    // True modals own every Lasso binding so nothing can change the page behind
    // them. Escape and help retain their modal-local meaning below.
    if (cmd === "escape") {
      // AppState closes surfaces in priority order. Picker cleanup must run only
      // when the picker is the surface Esc will close.
      if (!app.welcomeOpen.value && !app.shortcutsOpen.value && app.pickerOpen.value) {
        picker.act({ type: "close" });
      }
      if (
        app.welcomeOpen.value ||
        app.shortcutsOpen.value ||
        app.pickerOpen.value ||
        app.folderPickerOpen.value ||
        app.reviewOpen.value
      ) {
        return app.handleEscape();
      }
      if (activeAssignment) return true;
      return app.handleEscape();
    }
    if (cmd === "help") {
      if (app.shortcutsOpen.value) {
        app.shortcutsOpen.value = false;
        return true;
      }
      if (app.welcomeOpen.value || app.pickerOpen.value || app.folderPickerOpen.value) return true;
      app.shortcutsOpen.value = true;
      return true;
    }
    if (app.modalOpen()) return true;
    // An assignment owns the selection, progress, Stop, and undo lifetime.
    // Escape/help above keep their existing modal grammar; every other Lasso key
    // is consumed here until this run's finally block releases the lock.
    if (activeAssignment) return true;

    switch (cmd) {
      case "undo":
        return undo.trigger();
      case "toggle-select-mode":
        selection.setSelectMode(!selection.selectMode.value);
        return true;
      // The two filter keys return false when no filter store is wired, so the
      // bare keys fall through to X untouched (ADR-0010 — never load-bearing).
      case "toggle-filter": {
        if (!filter || !filterInScope()) return false;
        filterCommand((f) => f.setEnabled(!f.state.value.enabled));
        return true;
      }
      case "toggle-reveal": {
        if (!filter || !filterInScope()) return false;
        filterCommand((f) => f.setRevealed(!f.revealed.value));
        return true;
      }
      case "toggle-select": {
        const author = target.author();
        if (author) toggleSelect(author);
        else nudge();
        return true;
      }
      case "select-and-add-to-list": {
        // Double-tap s: ensure the focused author stays selected, then open the
        // List picker (does not toggle off if the first s already selected them).
        const author = target.author();
        if (!author) {
          if (selection.count.value === 0) {
            nudge();
            return true;
          }
          openPicker("keyboard");
          return true;
        }
        selection.add(author);
        openPicker("keyboard");
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
      case "save-to-default-folder": {
        const tweet = target.tweet();
        if (!tweet) {
          nudge();
          return true;
        }
        // Climb before capturing: a cursor inside a quoted post must file the
        // HOST post, and a repost the underlying one. outermostTweet returns its
        // argument when nothing encloses it and null only for a null input, so
        // the non-null assertion cannot fire for a non-null tweet.
        const post = capturePost(outermostTweet(tweet) as Element);
        void saveToDefaultFolder(post);
        return true;
      }
      case "open-folder-picker": {
        openFolderPicker();
        return true;
      }
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
    return false;
  }

  return {
    command,
    filterCommand,
    openPicker,
    pickerEffect,
    openFolderPicker,
    openFolderPickerForArticle,
    folderPickerEffect,
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
