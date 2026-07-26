import { signal } from "@preact/signals-core";

import { App } from "@/content/app";
import { createAppState } from "@/content/app-state";
import { createContentActivation, type ActivationLifecycle } from "@/content/content-activation";
import { createLassoController, type LassoController } from "@/content/controller";
import { installFilterFeature } from "@/content/filter-feature";
import { getCurrentAccount } from "@/content/get-current-account";
import { getFocusedTweet } from "@/content/get-focused-tweet";
import { createChromeCatalogCache } from "@/content/graphql-catalog-cache";
import { createHighContrastHosts } from "@/content/high-contrast-hosts";
import { installHoverTracker } from "@/content/hover-tracker";
import { DEFAULT_KEYMAP, installKeyboardLayer } from "@/content/keyboard";
import { outermostTweet } from "@/content/outermost-tweet";
import { createOverlayLifecycle } from "@/content/overlay-lifecycle";
import { isInScope, onRouteChange } from "@/content/route";
import { createScannerHealth } from "@/content/scanner-health";
import { installSelectTap } from "@/content/select-tap";
import { Selectors, SYNTHETIC_EVENT_FLAG } from "@/content/selectors";
import { mountTweetOverlay, TWEET_OVERLAY_ATTRIBUTE } from "@/content/tweet-overlay-mount";
import { createTweetScanner } from "@/content/tweet-scanner";
import { createCoach } from "@/core/coach";
import { createFilterStore } from "@/core/filter-store";
import { detectPlatform } from "@/core/keycaps";
import { createListCache } from "@/core/list-cache";
import { createListUsage } from "@/core/list-usage";
import { createMirrorStatusStore } from "@/core/mirror-status";
import { createPickerController } from "@/core/picker-controller";
import {
  isPopupToContentMessage,
  sendToBackground,
  type LassoStatusResponse,
} from "@/core/protocol";
import { createSelectionStore } from "@/core/selection-store";
import { createSettings, type SettingsStore } from "@/core/settings";
import { createToastStore } from "@/core/toast-store";
import { createUndoRegistry } from "@/core/undo";
import { createMembershipStore } from "@/packages/membership-store/factory";
import { createLiveMembershipStore } from "@/packages/membership-store/live";
import { createTweetActions } from "@/packages/tweet-actions/actions";
import * as tweetRead from "@/packages/tweet-read";
import { createXPageClient } from "@/packages/x-client/x-page-client";
import { createUiRoot } from "@/ui/mount";

const WELCOME_HASH = "#lasso-welcome";

const dispatchSyntheticEscape = (target: Document | Element): void => {
  const doc = target instanceof Document ? target : target.ownerDocument;
  const Event = doc.defaultView?.KeyboardEvent ?? KeyboardEvent;
  const event = new Event("keydown", {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: "Escape",
  });
  (event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG] = true;
  target.dispatchEvent(event);
};

const findAuthorCaret = (screenName: string): Element | null => {
  for (const article of document.querySelectorAll(Selectors.TWEET)) {
    const author = tweetRead.author(article);
    if (author?.screenName.toLowerCase() === screenName.toLowerCase()) {
      const caret = article.querySelector(Selectors.TWEET_CARET);
      if (caret) return caret;
    }
  }
  return null;
};

function installDormantSelectMode(request: () => void): () => void {
  const selectModeBindings = DEFAULT_KEYMAP.filter(
    (binding) => binding.command === "toggle-select-mode",
  );
  return installKeyboardLayer({
    keymap: selectModeBindings,
    run: (command) => {
      /* v8 ignore next -- the dormant keymap contains only the toggle-select-mode binding, so run() never receives another command */
      if (command !== "toggle-select-mode") return false;
      request();
      return true;
    },
  });
}

/* v8 ignore next -- installFilterFeature replaces this sentinel before any wired callback can read it */
const neverStubbed = (_tweet: Element): boolean => false;

/** Build one complete content capability. It either commits as a whole or unwinds. */
async function install(
  settingsStore: SettingsStore,
  lifecycle: ActivationLifecycle,
): Promise<LassoController> {
  // Read before creating any listener or host. An on-demand tab may have slept
  // through an Options write, so this is intentionally not main()'s snapshot.
  const settings = await settingsStore.get();
  const cleanups: Array<() => void> = [];
  const own = (cleanup: () => void): void => {
    cleanups.push(cleanup);
  };
  const rollback = (): void => {
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = cleanups[index]!;
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
    const tweetActions = createTweetActions({ dispatchSyntheticEscape });
    const platform = detectPlatform();
    const mirrorStatusStore = createMirrorStatusStore();

    const xPage = createXPageClient({
      initialBackend: settings.backend,
      settings: settingsStore,
      graphqlCache: createChromeCatalogCache(),
      findAuthorCaret,
      dispatchSyntheticEscape,
    });
    own(xPage.dispose);
    const backend = xPage.lists;
    const currentOwner = getCurrentAccount;
    // List discovery uses separate undocumented web v1.1 endpoints, not the mutation backend.
    const listCache = createListCache(() => xPage.ownedLists(), {
      currentOwner,
    });
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
          (await import("@/packages/membership-store/convex-client")).buildConvexMembershipStore,
      ),
    );
    own(membershipStore.dispose);
    const picker = createPickerController({
      cache: listCache,
      currentOwner,
      membershipStore,
      recentIds: (ownerUserId, limit) => listUsage.recentIds(ownerUserId, limit),
      memberships: (screenName) => xPage.membershipListIds(screenName),
    });

    // One shared filter store: the conductor mutates the same store the in-page
    // surfaces render, so filter commands flow through controller.filterCommand.
    const filterStore = createFilterStore();
    own(filterStore.dispose);
    let isFilterStubbed = neverStubbed;
    const assignableTweet = (): Element | null => {
      const tweet = hover.targetTweet();
      return tweet && !isFilterStubbed(tweet) ? tweet : null;
    };
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
      filterInScope: () => isInScope(location.pathname),
      settings: settingsStore,
      membershipStore,
      currentOwner,
      mirrorConfigurationId: membershipStore.configurationId,
      // The controller captures the opaque config identity before dispatch, so
      // an A write settling after a switch to B remains attributable to A.
      onMirrorResult: (result) => void mirrorStatusStore.publish(result),
      usage: listUsage,
      quick: {
        mute: (screenName) => xPage.mute(screenName),
        unmute: (screenName) => xPage.unmute(screenName),
        block: (screenName) => xPage.block(screenName),
        notInterested: (tweetEl) => tweetActions.notInterested(tweetEl),
      },
      target: {
        author: () => {
          const tweet = assignableTweet();
          return tweet ? tweetRead.author(tweet) : null;
        },
        tweet: assignableTweet,
      },
      openUrl: (url) => void window.open(url, "_blank", "noopener"),
      anchorFor: (tweetEl) => {
        // Open at the post's caret corner, where X's own "…" menu opens (beat 6).
        const caretEl = tweetEl.querySelector(Selectors.TWEET_CARET) ?? tweetEl;
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

    // The toolbar badge mirrors the live selection count (story beat 7).
    const reportSelectionCount = (): void =>
      sendToBackground({ type: "lasso:badge", count: selection.count.peek() });
    own(lifecycle.setAwakeReporter(reportSelectionCount));
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
    isFilterStubbed = filter.isStubbed;

    // Select mode: clicking anywhere on a visible post's body toggles it — sweeping
    // a thread is one click per post, no aiming at 22px circles (story beat 7).
    own(
      installSelectTap({
        isActive: () => selection.selectMode.value,
        resolveTarget: (eventTarget) => {
          const origin = eventTarget as Element | null;
          if (origin?.closest?.(`[${TWEET_OVERLAY_ATTRIBUTE}]`)) return null; // check handles itself
          if (origin?.closest?.("#lasso-root")) return null; // clicks on Lasso UI pass through
          const article = outermostTweet(origin?.closest?.(Selectors.TWEET) ?? null);
          return article && !isFilterStubbed(article) ? article : null;
        },
        onToggle: (article) => {
          const author = tweetRead.author(article);
          if (!author) return false;
          controller.toggleSelect(author);
        },
      }),
    );
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
          mountTweetOverlay(article, author, {
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

async function main(): Promise<void> {
  console.info("%c[Lasso] content script booted", "color:#1d9bf0;font-weight:bold", location.href);
  (window as unknown as { __lasso?: unknown }).__lasso = {
    booted: true,
    href: location.href,
  };
  const settingsStore = createSettings();
  const activation = createContentActivation({
    install: (lifecycle) => install(settingsStore, lifecycle),
    installDormantSelectMode,
    readInitialMode: async () => (await settingsStore.get()).activation,
    delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
    publishState: (state) => sendToBackground({ type: "lasso:state", state }),
    reportError: (message, error) => console.error(message, error),
  });

  // BFCache restores this document's heap without rerunning `main()`. The
  // active reporter preserves its current selection; an on-demand document
  // restores its explicit dormant state instead. Booting will publish on commit.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) activation.reannounce();
  });
  if ((document as Document & { prerendering?: boolean }).prerendering) {
    document.addEventListener("prerenderingchange", () => activation.reannounce(), {
      once: true,
    });
  }

  // The popup asks tabs for their state; on-demand tabs answer "asleep" (beat 9).
  try {
    chrome.runtime?.onMessage?.addListener?.(
      (msg: unknown, _sender, sendResponse: (r: LassoStatusResponse) => void) => {
        if (!isPopupToContentMessage(msg)) return;
        if (msg.type === "lasso:status") {
          sendResponse({ awake: activation.state() === "awake" });
          return;
        }
        void activation
          .activate("wake")
          .then((awake) => sendResponse({ awake }))
          .catch((error) => {
            console.error("[Lasso] activation response failed", error);
            sendResponse({ awake: false });
          });
        return true;
      },
    );
  } catch {
    // not running as an extension (e2e harness) — keyboard/UI still work
  }

  await activation.initialize();
}

main().catch((e) => console.error("[Lasso] init failed", e));
