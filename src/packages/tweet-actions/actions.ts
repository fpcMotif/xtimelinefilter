import {
  PAGE_ACTIVATE_CHANNEL,
  PAGE_ACTIVATE_READY,
  PAGE_ACTIVATE_REQUEST,
  PAGE_ACTIVATE_RESPONSE,
  PAGE_ACTIVATE_TARGET,
} from "@/core/protocol";

const textOf = (el: Element): string => el.textContent as string;

const TWEET = 'article[data-testid="tweet"]';
const CELL = 'div[data-testid="cellInnerDiv"]';
const CARET = '[data-testid="caret"]';
const MENU = '[role="menu"]';
const MENUITEM = '[role="menuitem"]';
const DROPDOWN = '[data-testid="Dropdown"]';
const SHEET = '[data-testid="sheetDialog"]';
const MENU_CONTAINER = `${DROPDOWN}, ${SHEET}, ${MENU}`;
const NOT_INTERESTED_ICON_PATH_PREFIX = "M12 13.6c1.64";
const NOT_INTERESTED_TEXT = /not interested|不感興趣|不感兴趣|興味がない/i;
const SHOW_FEWER_TEXT = /show fewer|see fewer|減少顯示|减少显示|表示を減らす/i;
const POST_NOT_RELEVANT_TEXT =
  /(?:post|this).*(?:not relevant|irrelevant|isn['’]t relevant)|not relevant|irrelevant|不相關|不相关|関連性が(?:ありません|ない)/i;
const UNDO_TEXT = /^\s*(undo|復原|复原|元に戻す)\s*$/i;

let activateSeq = 0;

async function mainWorldActivate(el: Element): Promise<boolean> {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || doc.documentElement.getAttribute(PAGE_ACTIVATE_READY) !== "1") return false;

  const id = `lasso-${Date.now()}-${activateSeq++}`;
  const requestId = `${id}-request`;
  el.setAttribute(PAGE_ACTIVATE_TARGET, id);

  return await new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      if (el.getAttribute(PAGE_ACTIVATE_TARGET) === id) el.removeAttribute(PAGE_ACTIVATE_TARGET);
      resolve(ok);
    };
    // No event.source check: same-window replies always have source === window
    // in real browsers (it filters nothing there), happy-dom delivers a wrapper
    // that never matches (making the handshake untestable), and the
    // channel + type + requestId triple already binds the reply.
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as {
        channel?: string;
        ok?: boolean;
        requestId?: string;
        type?: string;
      } | null;
      if (
        data?.channel !== PAGE_ACTIVATE_CHANNEL ||
        data.type !== PAGE_ACTIVATE_RESPONSE ||
        data.requestId !== requestId
      ) {
        return;
      }
      finish(data.ok === true);
    };
    // The bridge strips the target attribute BEFORE clicking, so on an ack
    // timeout "attribute gone" proves the click landed — count it as handled,
    // or the isolated fallback would click a second time and re-toggle the
    // caret, closing the menu the bridge just opened.
    const timer = win.setTimeout(() => finish(el.getAttribute(PAGE_ACTIVATE_TARGET) !== id), 250);
    win.addEventListener("message", onMessage);
    win.postMessage(
      { channel: PAGE_ACTIVATE_CHANNEL, id, requestId, type: PAGE_ACTIVATE_REQUEST },
      "*",
    );
  });
}

const isolatedActivate = (el: Element): void => {
  const target = el as HTMLElement;

  const win = target.ownerDocument.defaultView;
  if (!win) {
    target.click();
    return;
  }

  // Scroll only when off-screen: re-centering a visible target jolts the
  // timeline and can scroll the page under the open #layers dropdown.
  const pre = target.getBoundingClientRect();
  if (pre.bottom < 0 || pre.top > win.innerHeight) {
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
  }

  const rect = target.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX,
    clientY,
    button: 0,
  };

  const pointer = (type: string, buttons: number): void => {
    if (typeof win.PointerEvent === "function") {
      target.dispatchEvent(
        new win.PointerEvent(type, {
          ...base,
          buttons,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    }
  };
  const mouse = (type: string, buttons: number): void => {
    target.dispatchEvent(new win.MouseEvent(type, { ...base, buttons }));
  };

  pointer("pointerover", 0);
  mouse("mouseover", 0);
  pointer("pointerdown", 1);
  mouse("mousedown", 1);
  pointer("pointerup", 0);
  mouse("mouseup", 0);
  mouse("click", 0);
};

const activate = async (el: Element): Promise<void> => {
  if (await mainWorldActivate(el)) return;
  isolatedActivate(el);
};

const notInterestedMatch = (el: Element): boolean =>
  !!el.querySelector(`svg path[d^="${NOT_INTERESTED_ICON_PATH_PREFIX}"]`) ||
  NOT_INTERESTED_TEXT.test(textOf(el));

export interface TweetActionsDeps {
  /** Dispatches an Escape that Lasso's keyboard layer must ignore. */
  dispatchSyntheticEscape(target: Document | Element): void;
  doc?: Document;
  timeoutMs?: number;
  settle?: (ms: number) => Promise<void>;
}

export interface TweetActions {
  /**
   * Resolves "hidden" on success, "unavailable" when X offers no "not interested"
   * row for this post (e.g. off the home feed) — a no-op the caller can ignore.
   */
  notInterested(tweetEl: Element): Promise<"hidden" | "unavailable">;
}

/**
 * X offers a given caret-menu row only in some contexts — "not interested" exists on
 * the home feed but NOT on profiles, post-detail pages, lists or search (verified live
 * 2026-06-21). There the menu opens with other rows but ours is simply absent; that is
 * "not available here", not breakage. Thrown distinctly from a plain Error so callers
 * (controller.hideTweet) can stay silent instead of showing a futile failure + Retry.
 */
export class TweetActionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TweetActionUnavailableError";
  }
}

function waitForEl(
  find: () => Element | null,
  timeout: number,
  root: Node,
): Promise<Element | null> {
  const existing = find();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (el: Element | null): void => {
      clearTimeout(timer);
      obs.disconnect();
      resolve(el);
    };
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) finish(el);
    });
    timer = setTimeout(() => finish(find()), timeout);
    obs.observe(root, { childList: true, subtree: true });
  });
}

/**
 * The follow-up panel after "not interested": [undo, show fewer from this user,
 * irrelevant]. Current X renders these INSIDE a new article that has no
 * data-testid="tweet" (verified live 2026-06-12), so only exclude buttons still
 * inside a real tweet article. Prefer the post-level "irrelevant" feedback;
 * fall back to "show fewer", then position, never undo.
 */
function findNotInterestedFeedback(cellEl: Element): Element | null {
  const outside = [...cellEl.querySelectorAll('button, [role="button"]')].filter(
    (b) => !b.closest(TWEET),
  );
  const byPost = outside.find((b) => POST_NOT_RELEVANT_TEXT.test(textOf(b)));
  if (byPost) return byPost;
  const byFewer = outside.find((b) => SHOW_FEWER_TEXT.test(textOf(b)));
  if (byFewer) return byFewer;
  const positional =
    outside.length >= 3
      ? (outside[2] as Element)
      : outside.length >= 2
        ? (outside[1] as Element)
        : null;
  return positional && !UNDO_TEXT.test(textOf(positional)) ? positional : null;
}

/**
 * Drives X's tweet-caret "not interested" action. It owns the live-DOM retry,
 * feedback and cleanup protocol; callers only provide the focused tweet.
 */
export function createTweetActions(deps: TweetActionsDeps): TweetActions {
  const doc = deps.doc ?? document;
  const timeoutMs = deps.timeoutMs ?? 4000;
  const settle = deps.settle ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // Rows render with the menu container in one shot (live), so when our row is absent
  // it will never appear — cap the row wait well under timeoutMs to fail fast instead
  // of hanging the full 4s on an unsupported post.
  const rowWaitMs = Math.min(timeoutMs, 1500);

  const menuContainers = (): Element[] => [...doc.querySelectorAll(MENU_CONTAINER)];

  async function dismissOpenMenus(): Promise<void> {
    if (menuContainers().length === 0) return;
    for (const node of [doc, doc.body]) deps.dispatchSyntheticEscape(node);
    await settle(80);
  }

  // Synthetic Escape and outside pointer clicks do NOT close X's #layers caret menu
  // (verified live 2026-06-21) — only re-activating the owning caret toggles it shut.
  // Try Escape first (closes sheets / older builds), then toggle the caret for live X.
  async function dismissMenu(caret: Element): Promise<void> {
    if (menuContainers().length === 0) return;
    await dismissOpenMenus();
    if (menuContainers().length === 0) return;
    await activate(caret);
    await settle(60);
  }

  async function openMenu(tweetEl: Element): Promise<{ menu: Element; caret: Element }> {
    // Quoted tweets nest articles; the inner article has no caret — climb out.
    const caret =
      tweetEl.querySelector(CARET) ?? tweetEl.parentElement?.closest(TWEET)?.querySelector(CARET);
    if (!caret) throw new Error("Lasso: caret button not found on the focused tweet");
    await dismissOpenMenus();
    const staleMenus = new Set(menuContainers());
    await activate(caret);
    const menu = await waitForEl(
      () => menuContainers().find((m) => !staleMenus.has(m)) ?? null,
      timeoutMs,
      doc.body,
    );
    if (!menu) throw new Error("Lasso: caret menu did not open");
    return { menu, caret };
  }

  // Rows can render after the menu container; scope matching to the fresh menu
  // so a stray open menu cannot shadow the target tweet.
  const waitForRow = (
    menu: Element,
    match: (el: Element) => boolean,
    timeout: number,
  ): Promise<Element | null> =>
    waitForEl(() => [...menu.querySelectorAll(MENUITEM)].find(match) ?? null, timeout, menu);

  // X removes the menu once it accepts a row click — "no connected menu
  // container holds a row anymore" is the acceptance signal. Checking the
  // CAPTURED container alone is wrong: X can swap the whole dropdown for a
  // fresh one mid-flight, and a dead container must not read as "accepted".
  const anyMenuRowsOpen = (): boolean => menuContainers().some((m) => m.querySelector(MENUITEM));

  async function waitForMenuClose(timeout: number): Promise<boolean> {
    for (let i = Math.max(1, Math.ceil(timeout / 50)); i > 0; i--) {
      if (!anyMenuRowsOpen()) return true;
      await settle(50);
    }
    return !anyMenuRowsOpen();
  }

  // Click-time row lookup across all CONNECTED menu containers (document
  // queries never see detached subtrees), so a container swap hands us the
  // live row instead of the dead one.
  const findLiveRow = (match: (el: Element) => boolean): Element | null =>
    menuContainers()
      .flatMap((m) => [...m.querySelectorAll(MENUITEM)])
      .find(match) ?? null;

  async function run(tweetEl: Element, match: (el: Element) => boolean): Promise<void> {
    const { menu, caret } = await openMenu(tweetEl);
    try {
      let row = await waitForRow(menu, match, rowWaitMs);
      if (!row) {
        const labels = [...menu.querySelectorAll(MENUITEM)]
          .map((r) => textOf(r).trim().slice(0, 24))
          .join(" | ");
        // The menu opened with other rows but not ours — X offers no such action in
        // this context. Unavailable, not breakage (caller decides whether to surface).
        throw new TweetActionUnavailableError(
          `Lasso: target menu item not found (rows: ${labels})`,
        );
      }
      await settle(100);
      for (let attempt = 0; ; attempt++) {
        // X re-renders fresh menus; a row grabbed before a re-render is detached
        // and clicking it goes nowhere — re-find the LIVE row at click time.
        if (!row.isConnected) {
          row = (await waitForEl(() => findLiveRow(match), 500, doc.body)) ?? row;
        }
        await activate(row);
        if (await waitForMenuClose(900)) break;
        if (attempt >= 1) throw new Error("Lasso: X did not accept the menu click");
        await settle(150);
      }
    } catch (e) {
      await dismissMenu(caret); // never leave the user staring at a stuck-open menu
      throw e;
    }
  }

  // After the menu action, X swaps the article for a feedback panel. Require
  // that real X-side effect before reporting success.
  async function notInterested(tweetEl: Element): Promise<"hidden" | "unavailable"> {
    const cellEl = tweetEl.closest(CELL); // capture before X replaces the article
    try {
      await run(tweetEl, notInterestedMatch);
    } catch (e) {
      // X offers no "not interested" here (profile / post page / list / search) — a
      // silent no-op for the caller, not a failure. Genuine errors still propagate.
      if (e instanceof TweetActionUnavailableError) return "unavailable";
      throw e;
    }
    if (!cellEl) return "hidden";
    const effect = await waitForEl(
      () => {
        const feedback = findNotInterestedFeedback(cellEl);
        if (feedback) return feedback;
        return !doc.contains(tweetEl) || !cellEl.contains(tweetEl) ? cellEl : null;
      },
      timeoutMs,
      cellEl,
    );
    if (!effect) throw new Error("Lasso: not-interested did not update the post");
    // The tweet article can unmount a beat before the panel buttons render
    // (seen live 2026-06-12: a fast run skipped the follow-up) — give the
    // panel a short grace window instead of bailing once the article is gone.
    let feedback: Element | null = effect;
    if (effect === cellEl) {
      feedback = await waitForEl(() => findNotInterestedFeedback(cellEl), 800, cellEl);
    }
    if (feedback) {
      await settle(120);
      await activate(feedback);
    }
    return "hidden";
  }

  return { notInterested };
}
