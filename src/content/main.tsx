import { computed, signal } from "@preact/signals-core";
import { render } from "preact";

import { App, OverlayBinding } from "@/content/app";
import { createAppState } from "@/content/app-state";
import { createLassoController, type LassoController } from "@/content/controller";
import { installFilterFeature } from "@/content/filter-feature";
import { getCurrentAccount } from "@/content/get-current-account";
import { getFocusedTweet } from "@/content/get-focused-tweet";
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
import { buildConvexMembershipStore } from "@/core/membership-store/convex-client";
import { createMembershipStore } from "@/core/membership-store/factory";
import { createMirrorStatusStore } from "@/core/mirror-status";
import { createPickerController } from "@/core/picker-controller";
import { isLassoMessage, sendToBackground, type LassoStatusResponse } from "@/core/protocol";
import {
  createSelectionStore,
  type SelectionStore,
  type TweetAuthor,
} from "@/core/selection-store";
import { createSettings, type LassoSettings } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import * as tweetRead from "@/core/tweet-read";
import { createUndoRegistry } from "@/core/undo";
import { createDocumentAuth } from "@/core/x-client/auth";
import { createCaretActions } from "@/core/x-client/caret-actions";
import { DomXListApi } from "@/core/x-client/dom-api";
import { createDomPageDriver } from "@/core/x-client/dom-page-driver";
import { createXListApi } from "@/core/x-client/factory";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import { DEFAULT_GRAPHQL_CONFIG } from "@/core/x-client/graphql-config";
import { fetchMembershipListIds, fetchOwnedLists } from "@/core/x-client/lists-provider";
import { blockUser, muteUser, RestXListApi, unmuteUser } from "@/core/x-client/rest-api";
import { attachShadowRoot, createUiRoot } from "@/ui/mount";

const OVERLAY_FLAG = "data-lasso-overlay";
const WELCOME_HASH = "#lasso-welcome";

interface OverlayDeps {
  selection: SelectionStore;
  controller: LassoController;
  coach: ReturnType<typeof createCoach>;
  visualHover: ReturnType<typeof signal<Element | null>>;
  highContrast: boolean;
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
  if (deps.highContrast) host.setAttribute("data-hc", "");
  if (avatar) {
    if (getComputedStyle(avatar).position === "static") avatar.style.position = "relative";
    host.style.cssText = "position:absolute;right:-4px;bottom:-4px;z-index:10;display:block";
    avatar.appendChild(host);
  } else {
    host.style.cssText = "display:inline-flex;vertical-align:middle;margin-inline-end:6px";
    anchor.prepend(host);
  }

  const hovered = computed(() => deps.visualHover.value === article);
  const { mount } = attachShadowRoot(host);
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
  return () => {
    render(null, mount); // unmount → useSignalValue effects drop their subscriptions
    host.remove();
  };
}

let started = false;

async function start(settings: LassoSettings, activatedByUser: boolean): Promise<void> {
  if (started) return;
  started = true;

  const selection = createSelectionStore();
  const appState = createAppState(selection);
  const toasts = createToastStore();
  const undo = createUndoRegistry();
  const coach = createCoach();
  const settingsStore = createSettings();
  const auth = createDocumentAuth();
  const pageFetch = window.fetch.bind(window);
  const caret = createCaretActions();
  const platform = detectPlatform();
  const mirrorStatusStore = createMirrorStatusStore();

  const backend = createXListApi(settings.backend, {
    rest: () => new RestXListApi(pageFetch, () => auth.credentials()),
    dom: () => new DomXListApi(createDomPageDriver()),
    graphql: () =>
      new GraphqlXListApi(auth.credentials(), { fetch: pageFetch, config: DEFAULT_GRAPHQL_CONFIG }),
  });
  // List discovery via the stable v1.1 endpoint, decoupled from the add-backend.
  const listCache = createListCache(() =>
    fetchOwnedLists({ fetch: pageFetch, creds: auth.credentials() }),
  );
  const listUsage = createListUsage();
  const picker = createPickerController({
    cache: listCache,
    recentIds: (limit) => listUsage.recentIds(limit),
    memberships: (screenName) =>
      fetchMembershipListIds({ fetch: pageFetch, creds: auth.credentials() }, screenName),
  });

  // Quick actions target the tweet under the mouse (fallback: X's native j/k focus),
  // so Alt+m / Alt+n work without pressing j first. visualHover tracks the pointer
  // precisely (overlay fade-in); the tracker's sticky target stays put for command
  // targeting.
  const visualHover = signal<Element | null>(null);
  const hover = installHoverTracker({
    resolve: (el) => outermostTweet(el?.closest?.(Selectors.TWEET) ?? null),
    onHover: (article) => {
      visualHover.value = article;
    },
    fallback: () => getFocusedTweet(document),
  });

  // Off-to-the-side Mirror (ADR-0009): built only when a device key is configured,
  // otherwise NullMembershipStore ⇒ the X flow is byte-for-byte unchanged.
  const mirrorConfigured = !!(settings.convexUrl && settings.convexDeviceKey);
  const membershipStore = createMembershipStore(
    { convexUrl: settings.convexUrl, convexDeviceKey: settings.convexDeviceKey },
    buildConvexMembershipStore,
  );

  const creds = () => ({ fetch: pageFetch, creds: auth.credentials() });
  // One shared filter store: the conductor mutates the same store the in-page
  // surfaces render, so filter commands flow through controller.filterCommand.
  const filterStore = createFilterStore();
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
    currentOwner: () => getCurrentAccount(),
    // Status only makes sense for a real Mirror — the Null store "succeeding"
    // must not paint a green "synced" row for users who never configured one.
    ...(mirrorConfigured ? { onMirrorResult: mirrorStatusStore.publish } : {}),
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
  if (settings.highContrast) uiHost.host.setAttribute("data-hc", "");
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

  // Vim-style keyboard layer (j/k are X-native and never intercepted).
  installKeyboardLayer({ keymap: DEFAULT_KEYMAP, run: (command) => controller.command(command) });

  // Select mode: clicking anywhere on a post's body toggles it — sweeping a
  // thread is one click per post, no aiming at 22px circles (story beat 7).
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
  });

  // The toolbar badge mirrors the live selection count (story beat 7).
  selection.count.subscribe((count) => sendToBackground({ type: "lasso:badge", count }));

  // Filter capability (ADR-0010, spec §3): one self-contained feature unit owns
  // the store, the live-timeline applier, the in-page surfaces, and route sync.
  const filter = await installFilterFeature({
    settings: settingsStore,
    highContrast: settings.highContrast,
    inScope: () => isInScope(location.pathname),
    store: filterStore,
    conduct: controller.filterCommand,
  });
  onRouteChange(() => filter.sync());

  // Selector breakage detection (story beat 8).
  const health = createScannerHealth({ onBreakage: () => controller.reportBreakage() });
  // Live overlays only: each pruned cell's disposer runs on removal, so the registry —
  // and the signal subscriber lists behind it — stay bounded by the visible timeline.
  const overlays = createOverlayLifecycle();
  createTweetScanner(
    document,
    (author, article) => {
      // Classify first; a Hidden cell is inert for List-assign (no overlay).
      filter.classify(article);
      if (filter.isStubbed(article)) return;
      overlays.attach(article, () =>
        injectOverlay(article, author, {
          selection,
          controller,
          coach,
          visualHover,
          highContrast: settings.highContrast,
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
  ).start();

  // First run: the welcome card (story beat 3) — forced by the install hash,
  // otherwise shown once until dismissed.
  if (location.hash === WELCOME_HASH) {
    appState.welcomeOpen.value = true;
    history.replaceState(null, "", location.pathname + location.search);
  } else if (!(await coach.isOnboarded())) {
    appState.welcomeOpen.value = true;
  }

  sendToBackground({ type: "lasso:state", state: "awake" }); // clears any "zz" badge
  if (activatedByUser) controller.wake();
}

async function main(): Promise<void> {
  console.info("%c[Lasso] content script booted", "color:#1d9bf0;font-weight:bold", location.href);
  (window as unknown as { __lasso?: unknown }).__lasso = { booted: true, href: location.href };
  const settings = await createSettings().get();

  // The popup asks tabs for their state; on-demand tabs answer "asleep" (beat 9).
  try {
    chrome.runtime?.onMessage?.addListener?.(
      (msg: unknown, _sender, sendResponse: (r: LassoStatusResponse) => void) => {
        if (!isLassoMessage(msg)) return;
        if (msg.type === "lasso:status") {
          sendResponse({ awake: started });
          return;
        }
        if (msg.type === "lasso-activate") void start(settings, true);
      },
    );
  } catch {
    // not running as an extension (e2e harness) — keyboard/UI still work
  }

  if (settings.activation === "auto") {
    await start(settings, false);
  } else {
    // on-demand: stay inert until the popup wakes this tab (ADR-0006); the
    // toolbar shows a "zz" badge so dormancy is visible.
    sendToBackground({ type: "lasso:state", state: "asleep" });
  }
}

main().catch((e) => console.error("[Lasso] init failed", e));
