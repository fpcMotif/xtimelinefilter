import { computed, signal } from "@preact/signals-core";
import { render } from "preact";

import { App, OverlayBinding } from "@/content/app";
import { createAppState } from "@/content/app-state";
import { createBadgeReannouncer, type BadgeActivationState } from "@/content/badge-lifecycle";
import { createLassoController, type LassoController } from "@/content/controller";
import { installFilterFeature } from "@/content/filter-feature";
import { getCurrentAccount } from "@/content/get-current-account";
import { getFocusedTweet } from "@/content/get-focused-tweet";
import { createHighContrastHosts, type HighContrastHosts } from "@/content/high-contrast-hosts";
import { installHoverTracker } from "@/content/hover-tracker";
import { DEFAULT_KEYMAP, installKeyboardLayer } from "@/content/keyboard";
import { outermostTweet } from "@/content/outermost-tweet";
import { createOverlayLifecycle } from "@/content/overlay-lifecycle";
import { isInScope, onRouteChange } from "@/content/route";
import { createScannerHealth } from "@/content/scanner-health";
import { installSelectTap } from "@/content/select-tap";
import { DriverSelectors, Selectors } from "@/content/selectors";
import { createTweetScanner } from "@/content/tweet-scanner";
import { createCoach } from "@/core/coach";
import { createFilterStore } from "@/core/filter-store";
import { detectPlatform } from "@/core/keycaps";
import { createListCache } from "@/core/list-cache";
import { createListUsage } from "@/core/list-usage";
import { createMembershipStore } from "@/core/membership-store/factory";
import { createLiveMembershipStore } from "@/core/membership-store/live";
import { createMirrorStatusStore } from "@/core/mirror-status";
import { createPickerController } from "@/core/picker-controller";
import {
  isPopupToContentMessage,
  sendToBackground,
  type LassoStatusResponse,
} from "@/core/protocol";
import {
  createSelectionStore,
  type SelectionStore,
  type TweetAuthor,
} from "@/core/selection-store";
import { createSettings, type SettingsStore } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import * as tweetRead from "@/core/tweet-read";
import { createUndoRegistry } from "@/core/undo";
import { createDocumentAuth } from "@/core/x-client/auth";
import { createCaretActions } from "@/core/x-client/caret-actions";
import { createDomPageDriver } from "@/core/x-client/dom-page-driver";
import { createXListApi } from "@/core/x-client/factory";
import { fetchMembershipListIds, fetchOwnedLists } from "@/core/x-client/lists-provider";
import { blockUser, muteUser, unmuteUser } from "@/core/x-client/rest-api";
import { attachShadowRoot, createUiRoot } from "@/ui/mount";

const OVERLAY_FLAG = "data-lasso-overlay";
const WELCOME_HASH = "#lasso-welcome";

interface OverlayDeps {
  selection: SelectionStore;
  controller: LassoController;
  coach: ReturnType<typeof createCoach>;
  visualHover: ReturnType<typeof signal<Element | null>>;
  highContrastHosts: HighContrastHosts;
}

/**
 * 22px check at the avatar's bottom-right corner — exactly where X puts its own.
 * Returns a disposer that unmounts the Preact tree: the overlay subscribes to
 * long-lived signals (selection.count/selectMode, the hover computed), so a cell
 * X's virtualization prunes MUST be unmounted or its whole detached subtree stays
 * reachable from the signal graph — memory grows with every scrolled-past post
 * and each mousemove/selection edit pays for every overlay ever mounted.
 */
function injectOverlay(
  article: Element,
  author: TweetAuthor,
  deps: OverlayDeps,
): (() => void) | null {
  const avatar = article.querySelector<HTMLElement>(Selectors.AVATAR_CONTAINER);
  const anchor = avatar ?? article.querySelector('[data-testid="User-Name"]') ?? article;
  if (anchor.querySelector(`[${OVERLAY_FLAG}]`)) return null;

  const host = document.createElement("span");
  host.setAttribute(OVERLAY_FLAG, "");
  const previousPosition = avatar?.style.position;
  let positionedAvatar = false;
  if (avatar) {
    if (getComputedStyle(avatar).position === "static") {
      avatar.style.position = "relative";
      positionedAvatar = true;
    }
    host.style.cssText = "position:absolute;right:-4px;bottom:-4px;z-index:10;display:block";
    avatar.appendChild(host);
  } else {
    host.style.cssText = "display:inline-flex;vertical-align:middle;margin-inline-end:6px";
    anchor.prepend(host);
  }

  let unregisterHost: (() => void) | undefined;
  let mount: Element | undefined;
  try {
    const hovered = computed(() => deps.visualHover.value === article);
    unregisterHost = deps.highContrastHosts.register(host);
    mount = attachShadowRoot(host).mount;
    render(
      <OverlayBinding
        selection={deps.selection}
        author={author}
        hovered={hovered}
        coach={deps.coach}
        onToggle={() => deps.controller.toggleSelect(author)}
      />,
      mount,
    );
  } catch (error) {
    unregisterHost?.();
    host.remove();
    if (positionedAvatar && avatar) avatar.style.position = previousPosition ?? "";
    throw error;
  }
  return () => {
    render(null, mount!); // unmount → useSignalValue effects drop their subscriptions
    unregisterHost?.();
    host.remove();
    if (positionedAvatar && avatar) avatar.style.position = previousPosition ?? "";
  };
}

type ActivationState = BadgeActivationState;
type ActivationIntent = "silent" | "wake" | "select-mode";

let activationState: ActivationState = "idle";
let boot: Promise<boolean> | null = null;
let wakeAfterCommit = false;
let selectModeAfterCommit = false;
let disposeDormantKeyboard: (() => void) | null = null;
const badgeReannouncer = createBadgeReannouncer({
  activationState: () => activationState,
  publishDormant: () => sendToBackground({ type: "lasso:state", state: "asleep" }),
});

function ensureDormantKeyboard(settingsStore: SettingsStore): void {
  if (disposeDormantKeyboard || activationState === "awake") return;
  const selectModeBindings = DEFAULT_KEYMAP.filter(
    (binding) => binding.command === "toggle-select-mode",
  );
  disposeDormantKeyboard = installKeyboardLayer({
    keymap: selectModeBindings,
    run: (command) => {
      if (command !== "toggle-select-mode") return false;
      void activate(settingsStore, "select-mode");
      return true;
    },
  });
}

/** Build one complete content capability. It either commits as a whole or unwinds. */
async function install(settingsStore: SettingsStore): Promise<LassoController> {
  // Read before creating any listener or host. An on-demand tab may have slept
  // through an Options write, so this is intentionally not main()'s snapshot.
  const settings = await settingsStore.get();
  const cleanups: Array<() => void> = [];
  const own = (cleanup: () => void): void => {
    cleanups.push(cleanup);
  };
  const rollback = (): void => {
    for (const cleanup of [...cleanups].toReversed()) {
      try {
        cleanup();
      } catch (error) {
        console.error("[Lasso] activation cleanup failed", error);
      }
    }
  };

  try {
    const selection = createSelectionStore();
    const appState = createAppState(selection);
    const toasts = createToastStore();
    const undo = createUndoRegistry();
    const coach = createCoach();
    const auth = createDocumentAuth();
    const pageFetch = window.fetch.bind(window);
    const caret = createCaretActions();
    const platform = detectPlatform();
    const mirrorStatusStore = createMirrorStatusStore();

    const backend = createXListApi(settings.backend, {
      fetch: pageFetch,
      credentials: () => auth.credentials(),
      createPageDriver: () => createDomPageDriver(),
    });
    const currentOwner = getCurrentAccount;
    // List discovery uses separate undocumented web v1.1 endpoints, not the mutation backend.
    const listCache = createListCache(
      () => fetchOwnedLists({ fetch: pageFetch, creds: auth.credentials() }),
      { currentOwner },
    );
    const listUsage = createListUsage();
    // Quick actions target the tweet under the mouse (fallback: X's native j/k focus).
    // visualHover tracks the pointer precisely; the tracker's sticky target stays put
    // for command targeting. Mute remains an unbound programmatic command.
    const visualHover = signal<Element | null>(null);
    const hover = installHoverTracker({
      resolve: (el) => outermostTweet(el?.closest?.(Selectors.TWEET) ?? null),
      onHover: (article) => {
        visualHover.value = article;
      },
      fallback: () => getFocusedTweet(document),
    });
    own(hover.dispose);

    // One live facade owns Mirror replacement. A settings clear immediately
    // disconnects the old adapter; later writes cannot retain its device key.
    const membershipStore = createLiveMembershipStore(settings, settingsStore, (config) =>
      createMembershipStore(
        config,
        async () =>
          (await import("@/core/membership-store/convex-client")).buildConvexMembershipStore,
      ),
    );
    own(membershipStore.dispose);
    const picker = createPickerController({
      cache: listCache,
      currentOwner,
      membershipStore,
      recentIds: (ownerUserId, limit) => listUsage.recentIds(ownerUserId, limit),
      memberships: (screenName) =>
        fetchMembershipListIds({ fetch: pageFetch, creds: auth.credentials() }, screenName),
    });

    const creds = () => ({ fetch: pageFetch, creds: auth.credentials() });
    // One shared filter store: the conductor mutates the same store the in-page
    // surfaces render, so filter commands flow through controller.filterCommand.
    const filterStore = createFilterStore();
    own(filterStore.dispose);
    const controller = createLassoController({
      selection,
      app: appState,
      picker,
      toasts,
      undo,
      coach,
      backend,
      cache: listCache,
      filter: filterStore,
      settings: settingsStore,
      membershipStore,
      currentOwner,
      mirrorConfigurationId: membershipStore.configurationId,
      // The controller captures the opaque config identity before dispatch, so
      // an A write settling after a switch to B remains attributable to A.
      onMirrorResult: (result) => void mirrorStatusStore.publish(result),
      usage: listUsage,
      quick: {
        mute: (screenName) => muteUser(creds(), screenName),
        unmute: (screenName) => unmuteUser(creds(), screenName),
        block: (screenName) => blockUser(creds(), screenName),
        notInterested: (tweetEl) => caret.notInterested(tweetEl),
      },
      target: {
        author: () => {
          const tweet = hover.targetTweet();
          return tweet ? tweetRead.author(tweet) : null;
        },
        tweet: hover.targetTweet,
      },
      openUrl: (url) => void window.open(url, "_blank", "noopener"),
      anchorFor: (tweetEl) => {
        // Open at the post's caret corner, where X's own "…" menu opens (beat 6).
        const caretEl = tweetEl.querySelector(DriverSelectors.CARET) ?? tweetEl;
        const r = caretEl.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        const width = 320;
        return {
          left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
          top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 240)),
        };
      },
    });

    const uiHost = createUiRoot();
    own(uiHost.destroy);
    const highContrastHosts = createHighContrastHosts(settingsStore, settings.highContrast);
    own(highContrastHosts.dispose);
    own(highContrastHosts.register(uiHost.host));
    uiHost.render(
      <App
        selection={selection}
        appState={appState}
        picker={picker}
        toasts={toasts}
        controller={controller}
        coach={coach}
        keymap={DEFAULT_KEYMAP}
        platform={platform}
        openUrl={(url) => void window.open(url, "_blank", "noopener")}
      />,
    );

    // Select mode: clicking anywhere on a post's body toggles it — sweeping a
    // thread is one click per post, no aiming at 22px circles (story beat 7).
    own(
      installSelectTap({
        isActive: () => selection.selectMode.value,
        resolveTarget: (eventTarget) => {
          const origin = eventTarget as Element | null;
          if (origin?.closest?.(`[${OVERLAY_FLAG}]`)) return null; // the check handles itself
          if (origin?.closest?.("#lasso-root")) return null; // clicks on Lasso UI pass through
          return outermostTweet(origin?.closest?.(Selectors.TWEET) ?? null);
        },
        onToggle: (article) => {
          const author = tweetRead.author(article);
          if (!author) return false;
          controller.toggleSelect(author);
        },
      }),
    );

    // The toolbar badge mirrors the live selection count (story beat 7).
    const reportSelectionCount = (): void =>
      sendToBackground({ type: "lasso:badge", count: selection.count.peek() });
    own(badgeReannouncer.setAwakeReporter(reportSelectionCount));
    own(selection.count.subscribe((count) => sendToBackground({ type: "lasso:badge", count })));

    // Filter capability (ADR-0010, spec §3): one self-contained feature unit owns
    // the store, the live-timeline applier, the in-page surfaces, and route sync.
    const filter = await installFilterFeature({
      settings: settingsStore,
      highContrastHosts,
      inScope: () => isInScope(location.pathname),
      store: filterStore,
      conduct: controller.filterCommand,
    });
    own(filter.unmount);
    // One capture-phase owner for all document keys. An open Filter palette owns
    // every binding; otherwise app layers dismiss before lower Filter surfaces.
    own(
      installKeyboardLayer({
        keymap: DEFAULT_KEYMAP,
        run: (command) => {
          if (filter.isPaletteOpen()) {
            if (command === "escape") filter.dismiss();
            return true;
          }
          if (command !== "escape") return controller.command(command);
          return controller.command("escape") || filter.dismiss();
        },
        surfaces: {
          modalOpen: () => appState.modalOpen() || filter.isPaletteOpen(),
          paletteHotkey: filter.paletteHotkey,
          // A modal owns configured palette bindings too. Returning true
          // consumes the hotkey without opening Filter behind it.
          togglePalette: () => appState.modalOpen() || filter.togglePalette(),
        },
      }),
    );
    own(onRouteChange(() => filter.sync()));

    // Selector breakage detection (story beat 8).
    const health = createScannerHealth({
      onBreakage: () => controller.reportBreakage(),
    });
    // Live overlays only: each pruned cell's disposer runs on removal, so the registry —
    // and the signal subscriber lists behind it — stay bounded by the visible timeline.
    const overlays = createOverlayLifecycle();
    own(overlays.disposeAll);
    const scanner = createTweetScanner(
      document,
      (article) => {
        // Classify first. Collapse CSS hides the article and its descendants,
        // so a hidden overlay can stay mounted and reappear on restoration.
        filter.classify(article);
        const author = tweetRead.author(article);
        if (!author) return;
        overlays.attach(article, () =>
          injectOverlay(article, author, {
            selection,
            controller,
            coach,
            visualHover,
            highContrastHosts,
          }),
        );
      },
      {
        onScan: (mutations, matches) => health.record(mutations, matches),
        onTweetRemoved: (article) => {
          overlays.releaseFor(article);
          // Drop hover refs so the pruned subtree is GC-able immediately.
          hover.release(article);
          if (visualHover.peek() === article) visualHover.value = null;
        },
      },
    );
    own(scanner.stop);
    scanner.start();

    // First run: the welcome card (story beat 3) — forced by the install hash,
    // otherwise shown once until dismissed.
    if (location.hash === WELCOME_HASH) {
      appState.welcomeOpen.value = true;
      history.replaceState(null, "", location.pathname + location.search);
    } else if (!(await coach.isOnboarded())) {
      appState.welcomeOpen.value = true;
    }

    return controller;
  } catch (error) {
    rollback();
    throw error;
  }
}

/** Coalesced transactional activation. `true` means every lifetime committed. */
function activate(settingsStore: SettingsStore, intent: ActivationIntent): Promise<boolean> {
  if (activationState === "awake") return Promise.resolve(true);
  if (activationState === "booting") {
    if (intent === "wake") wakeAfterCommit = true;
    if (intent === "select-mode") selectModeAfterCommit = true;
    return boot!;
  }

  activationState = "booting";
  wakeAfterCommit = intent === "wake";
  selectModeAfterCommit = intent === "select-mode";
  const attempt = (async (): Promise<boolean> => {
    try {
      const controller = await install(settingsStore);
      activationState = "awake";
      disposeDormantKeyboard?.();
      disposeDormantKeyboard = null;
      sendToBackground({ type: "lasso:state", state: "awake" });
      if (wakeAfterCommit) {
        wakeAfterCommit = false;
        try {
          controller.wake();
        } catch (error) {
          console.error("[Lasso] wake intent failed", error);
        }
      }
      if (selectModeAfterCommit) {
        selectModeAfterCommit = false;
        try {
          controller.trySelectMode();
        } catch (error) {
          console.error("[Lasso] select-mode intent failed", error);
        }
      }
      return true;
    } catch (error) {
      activationState = "idle";
      wakeAfterCommit = false;
      selectModeAfterCommit = false;
      sendToBackground({ type: "lasso:state", state: "asleep" });
      console.error("[Lasso] activation failed", error);
      return false;
    }
  })();
  boot = attempt;
  void attempt.finally(() => {
    if (boot === attempt) boot = null;
  });
  return attempt;
}

async function main(): Promise<void> {
  console.info("%c[Lasso] content script booted", "color:#1d9bf0;font-weight:bold", location.href);
  (window as unknown as { __lasso?: unknown }).__lasso = {
    booted: true,
    href: location.href,
  };
  const settingsStore = createSettings();

  // BFCache restores this document's heap without rerunning `main()`. The
  // active reporter preserves its current selection; an on-demand document
  // restores its explicit dormant state instead. Booting will publish on commit.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) badgeReannouncer.reannounce();
  });
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    document.addEventListener("prerenderingchange", () => badgeReannouncer.reannounce(), {
      once: true,
    });
  }

  // The popup asks tabs for their state; on-demand tabs answer "asleep" (beat 9).
  try {
    chrome.runtime?.onMessage?.addListener?.(
      (msg: unknown, _sender, sendResponse: (r: LassoStatusResponse) => void) => {
        if (!isPopupToContentMessage(msg)) return;
        if (msg.type === "lasso:status") {
          sendResponse({ awake: activationState === "awake" });
          return;
        }
        if (msg.type === "lasso-activate") {
          void activate(settingsStore, "wake")
            .then((awake) => sendResponse({ awake }))
            .catch((error) => {
              console.error("[Lasso] activation response failed", error);
              sendResponse({ awake: false });
            });
          return true;
        }
      },
    );
  } catch {
    // not running as an extension (e2e harness) — keyboard/UI still work
  }

  // Installed before hydration: a dead initial storage read must not strand an
  // on-demand tab. Successful auto or user activation disposes this owner.
  ensureDormantKeyboard(settingsStore);

  let settings: Awaited<ReturnType<SettingsStore["get"]>>;
  try {
    settings = await settingsStore.get();
  } catch (error) {
    // The listener above still lets a later toolbar activation retry this read.
    // A concurrent user activation owns the badge transition. Do not turn its
    // committed awake state back into `zz` with this older read failure.
    if (activationState === "idle") sendToBackground({ type: "lasso:state", state: "asleep" });
    console.error("[Lasso] init failed", error);
    return;
  }

  if (settings.activation === "auto") {
    await activate(settingsStore, "silent");
  } else if (activationState !== "awake") {
    // on-demand: stay inert until the popup wakes this tab (ADR-0006); the
    // toolbar shows a "zz" badge so dormancy is visible.
    if (activationState === "idle") sendToBackground({ type: "lasso:state", state: "asleep" });
  }
}

main().catch((e) => console.error("[Lasso] init failed", e));
