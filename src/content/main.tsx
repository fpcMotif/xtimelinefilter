import { signal } from "@preact/signals-core";
import { render } from "preact";

import { App, OverlayBinding } from "@/content/app";
import { getFocusedTweet } from "@/content/get-focused-tweet";
import { type CommandId, DEFAULT_KEYMAP, installKeyboardLayer } from "@/content/keyboard";
import { Selectors } from "@/content/selectors";
import { createTweetScanner } from "@/content/tweet-scanner";
import { createListCache } from "@/core/list-cache";
import { createListUsage } from "@/core/list-usage";
import {
  createSelectionStore,
  type SelectionStore,
  type TweetAuthor,
} from "@/core/selection-store";
import { createSettings } from "@/core/settings";
import { extractAuthor } from "@/core/tweet-extractor";
import { createDocumentAuth } from "@/core/x-client/auth";
import { createCaretActions } from "@/core/x-client/caret-actions";
import { DomXListApi } from "@/core/x-client/dom-api";
import { createDomPageDriver } from "@/core/x-client/dom-page-driver";
import { createXListApi } from "@/core/x-client/factory";
import { GraphqlXListApi } from "@/core/x-client/graphql-api";
import { DEFAULT_GRAPHQL_CONFIG } from "@/core/x-client/graphql-config";
import { fetchOwnedLists } from "@/core/x-client/lists-provider";
import { blockUser, muteUser, RestXListApi } from "@/core/x-client/rest-api";
import { attachShadowRoot, createUiRoot } from "@/ui/mount";

const OVERLAY_FLAG = "data-lasso-overlay";

function injectOverlay(article: Element, author: TweetAuthor, selection: SelectionStore): void {
  const anchor = article.querySelector('[data-testid="User-Name"]') ?? article;
  if (anchor.querySelector(`[${OVERLAY_FLAG}]`)) return;
  const host = document.createElement("span");
  host.setAttribute(OVERLAY_FLAG, "");
  host.style.cssText = "display:inline-flex;vertical-align:middle;margin-inline-end:6px";
  const { mount } = attachShadowRoot(host);
  anchor.prepend(host);
  render(<OverlayBinding selection={selection} author={author} />, mount);
}

let started = false;

async function start(): Promise<void> {
  if (started) return;
  started = true;

  const settings = await createSettings().get();
  const selection = createSelectionStore();
  const auth = createDocumentAuth();
  const pageFetch = window.fetch.bind(window);
  const caret = createCaretActions();
  const openPickerTick = signal(0);

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

  createUiRoot().render(
    <App
      selection={selection}
      backend={backend}
      listCache={listCache}
      listUsage={listUsage}
      openPickerTick={openPickerTick}
    />,
  );

  // Quick actions target the tweet under the mouse (fallback: X's native j/k focus),
  // so Alt+m / Alt+n work without pressing j first.
  let hovered: Element | null = null;
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
      if (t) hovered = t;
    },
    { capture: true, passive: true },
  );
  const targetTweet = (): Element | null =>
    hovered && document.contains(hovered) ? hovered : getFocusedTweet(document);

  // Vim-style keyboard layer (j/k are X-native and never intercepted).
  installKeyboardLayer({ keymap: DEFAULT_KEYMAP, run: (command) => void runCommand(command) });

  async function runCommand(command: CommandId): Promise<void> {
    if (command === "toggle-select-mode") {
      selection.setSelectMode(!selection.selectMode.value);
      return;
    }
    const tweetEl = targetTweet();
    if (!tweetEl) {
      console.warn("[Lasso] hover a tweet (or press j to focus one) first");
      return;
    }
    const author = extractAuthor(tweetEl);
    if (!author) return;
    const creds = () => ({ fetch: pageFetch, creds: auth.credentials() });
    try {
      switch (command) {
        case "toggle-select":
          selection.toggle(author);
          break;
        case "add-to-list":
          if (!selection.isSelected(author.screenName)) selection.toggle(author);
          openPickerTick.value += 1;
          break;
        case "mute":
          await muteUser(creds(), author.screenName);
          break;
        case "block":
          await blockUser(creds(), author.screenName);
          break;
        case "not-interested":
          await caret.notInterested(tweetEl);
          break;
      }
    } catch (e) {
      console.error("[Lasso] action failed:", command, e);
    }
  }

  createTweetScanner(document, (author, article) =>
    injectOverlay(article, author, selection),
  ).start();
}

async function main(): Promise<void> {
  console.info("%c[Lasso] content script booted", "color:#1d9bf0;font-weight:bold", location.href);
  (window as unknown as { __lasso?: unknown }).__lasso = { booted: true, href: location.href };
  const { activation } = await createSettings().get();
  if (activation === "auto") {
    await start();
  } else {
    // on-demand: stay inert until the toolbar icon activates this tab (ADR-0006).
    chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === "lasso-activate") void start();
    });
  }
}

main().catch((e) => console.error("[Lasso] init failed", e));
