import { computed, signal } from "@preact/signals-core";
import { render } from "preact";

import { App, OverlayBinding } from "@/content/app";
import { createAppState } from "@/content/app-state";
import { createLassoController, type LassoController } from "@/content/controller";
import { getFocusedTweet } from "@/content/get-focused-tweet";
import { DEFAULT_KEYMAP, installKeyboardLayer } from "@/content/keyboard";
import { getCurrentAccount } from "@/content/get-current-account";
import { createScannerHealth } from "@/content/scanner-health";
import { DriverSelectors, Selectors } from "@/content/selectors";
import { createTweetScanner } from "@/content/tweet-scanner";
import { createCoach } from "@/core/coach";
import { detectPlatform } from "@/core/keycaps";
import { createListCache } from "@/core/list-cache";
import { createListUsage } from "@/core/list-usage";
import { buildConvexMembershipStore } from "@/core/membership-store/convex-client";
import { createMembershipStore } from "@/core/membership-store/factory";
import { createPickerController } from "@/core/picker-controller";
import {
  createSelectionStore,
  type SelectionStore,
  type TweetAuthor,
} from "@/core/selection-store";
import { createSettings, type LassoSettings } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import { extractAuthor } from "@/core/tweet-extractor";
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

/** Best-effort runtime messaging — never lets a dead SW break the page UI. */
function sendToBackground(msg: Record<string, unknown>): void {
  try {
    void chrome.runtime?.sendMessage?.(msg)?.catch?.(() => {});
  } catch {
    // extension context gone (reload) — ignore
  }
}

interface OverlayDeps {
  selection: SelectionStore;
  controller: LassoController;
  coach: ReturnType<typeof createCoach>;
  visualHover: ReturnType<typeof signal<Element | null>>;
  highContrast: boolean;
}

/** 22px check at the avatar's bottom-right corner — exactly where X puts its own. */
function injectOverlay(article: Element, author: TweetAuthor, deps: OverlayDeps): void {
  const avatar = article.querySelector<HTMLElement>(Selectors.AVATAR_CONTAINER);
  const anchor = avatar ?? article.querySelector('[data-testid="User-Name"]') ?? article;
  if (anchor.querySelector(`[${OVERLAY_FLAG}]`)) return;

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
  // precisely (overlay fade-in); hoveredSticky stays put for command targeting.
  const visualHover = signal<Element | null>(null);
  let hoveredSticky: Element | null = null;
  document.addEventListener(
    "mousemove",
    (e) => {
      let t = (e.target as Element | null)?.closest?.(Selectors.TWEET) ?? null;
      // Quoted tweets nest articles — the outermost one owns the caret and author.
      while (t) {
        const outer = t.parentElement?.closest(Selectors.TWEET);
        if (!outer) break;
        t = outer;
      }
      visualHover.value = t;
      if (t) hoveredSticky = t;
    },
    { capture: true, passive: true },
  );
  const targetTweet = (): Element | null =>
    hoveredSticky && document.contains(hoveredSticky) ? hoveredSticky : getFocusedTweet(document);

  // Off-to-the-side Mirror (ADR-0009): built only when a device key is configured,
  // otherwise NullMembershipStore ⇒ the X flow is byte-for-byte unchanged.
  const membershipStore = createMembershipStore(
    { convexUrl: settings.convexUrl, convexDeviceKey: settings.convexDeviceKey },
    buildConvexMembershipStore,
  );

  const creds = () => ({ fetch: pageFetch, creds: auth.credentials() });
  const controller = createLassoController({
    selection,
    app: appState,
    picker,
    toasts,
    undo,
    coach,
    backend,
    cache: listCache,
    settings: settingsStore,
    membershipStore,
    currentOwner: () => getCurrentAccount(),
    usage: listUsage,
    quick: {
      mute: (screenName) => muteUser(creds(), screenName),
      unmute: (screenName) => unmuteUser(creds(), screenName),
      block: (screenName) => blockUser(creds(), screenName),
      notInterested: (tweetEl) => caret.notInterested(tweetEl),
    },
    target: {
      author: () => {
        const tweet = targetTweet();
        return tweet ? extractAuthor(tweet) : null;
      },
      tweet: targetTweet,
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
  document.addEventListener(
    "click",
    (e) => {
      if (!selection.selectMode.value) return;
      const origin = (e.composedPath?.()[0] ?? e.target) as Element | null;
      if (origin?.closest?.(`[${OVERLAY_FLAG}]`)) return; // the check handles itself
      if (origin?.closest?.("#lasso-root")) return; // clicks on Lasso UI pass through
      const article = origin?.closest?.(Selectors.TWEET);
      if (!article) return;
      const author = extractAuthor(article);
      if (!author) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      controller.toggleSelect(author);
    },
    { capture: true },
  );

  // The toolbar badge mirrors the live selection count (story beat 7).
  selection.count.subscribe((count) => sendToBackground({ type: "lasso:badge", count }));

  // Selector breakage detection (story beat 8).
  const health = createScannerHealth({ onBreakage: () => controller.reportBreakage() });
  createTweetScanner(
    document,
    (author, article) =>
      injectOverlay(article, author, {
        selection,
        controller,
        coach,
        visualHover,
        highContrast: settings.highContrast,
      }),
    { onScan: (mutations, matches) => health.record(mutations, matches) },
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
      (msg: { type?: string }, _sender, sendResponse: (r: unknown) => void) => {
        if (msg?.type === "lasso:status") {
          sendResponse({ awake: started });
          return;
        }
        if (msg?.type === "lasso-activate") void start(settings, true);
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
