import {
  DriverSelectors,
  MUTE_ICON_PATH_PREFIX,
  MUTE_TEXT,
  NOT_INTERESTED_ICON_PATH_PREFIX,
  NOT_INTERESTED_TEXT,
  POST_NOT_RELEVANT_TEXT,
  Selectors,
  SHOW_FEWER_TEXT,
  SYNTHETIC_EVENT_FLAG,
  UNDO_TEXT,
} from "@/content/selectors";

const textOf = (el: Element): string => el.textContent as string;
const PAGE_ACTIVATE_CHANNEL = "__lasso_x_main_world_activate__";
const PAGE_ACTIVATE_REQUEST = "activate";
const PAGE_ACTIVATE_RESPONSE = "activated";
const PAGE_ACTIVATE_READY = "data-lasso-main-world-activate";
const PAGE_ACTIVATE_TARGET = "data-lasso-activate-target";

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

const muteMatch = (el: Element): boolean =>
  !!el.querySelector(`svg path[d^="${MUTE_ICON_PATH_PREFIX}"]`) || MUTE_TEXT.test(textOf(el));
const blockMatch = (el: Element): boolean =>
  !!el.querySelector(DriverSelectors.BLOCK) ||
  el.getAttribute("data-testid") === "block" ||
  /^\s*block/i.test(textOf(el));
const notInterestedMatch = (el: Element): boolean =>
  !!el.querySelector(`svg path[d^="${NOT_INTERESTED_ICON_PATH_PREFIX}"]`) ||
  NOT_INTERESTED_TEXT.test(textOf(el));

export interface CaretActionDeps {
  doc?: Document;
  timeoutMs?: number;
  /** How long to wait for an optional confirmation sheet. */
  confirmTimeoutMs?: number;
  settle?: (ms: number) => Promise<void>;
}

export interface CaretActions {
  mute(tweetEl: Element): Promise<void>;
  notInterested(tweetEl: Element): Promise<void>;
  block(tweetEl: Element): Promise<void>;
}

type ConfirmMode = "always" | "if-present" | "never";

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
    (b) => !b.closest(Selectors.TWEET),
  );
  const byPost = outside.find((b) => POST_NOT_RELEVANT_TEXT.test(b.textContent ?? ""));
  if (byPost) return byPost;
  const byFewer = outside.find((b) => SHOW_FEWER_TEXT.test(b.textContent ?? ""));
  if (byFewer) return byFewer;
  const positional =
    outside.length >= 3
      ? (outside[2] as Element)
      : outside.length >= 2
        ? (outside[1] as Element)
        : null;
  return positional && !UNDO_TEXT.test(positional.textContent ?? "") ? positional : null;
}


/**
 * Drives the tweet "..." caret menu for quick actions on a focused tweet element
 * (docs/research/09). Row matching is tiered: data-testid / icon-path → localized
 * text. Confirmation sheet handling is per-action (Block always, Mute maybe,
 * Not-interested never). Live-DOM boundary — orchestration tested via fixtures.
 */
export function createCaretActions(deps: CaretActionDeps = {}): CaretActions {
  const doc = deps.doc ?? document;
  const timeoutMs = deps.timeoutMs ?? 4000;
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 1500;
  const settle = deps.settle ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const MENU_CONTAINER_SELECTOR = `${DriverSelectors.DROPDOWN}, ${DriverSelectors.SHEET}, ${DriverSelectors.MENU}`;

  const waitFor = (selector: string, timeout: number): Promise<Element | null> =>
    waitForEl(() => doc.querySelector(selector), timeout, doc.body);

  const menuContainers = (): Element[] => [...doc.querySelectorAll(MENU_CONTAINER_SELECTOR)];

  async function dismissOpenMenus(): Promise<void> {
    if (menuContainers().length === 0) return;
    const win = doc.defaultView;
    const init = { key: "Escape", bubbles: true, cancelable: true, composed: true };
    for (const node of [doc, doc.body]) {
      const ev = win ? new win.KeyboardEvent("keydown", init) : new KeyboardEvent("keydown", init);
      // Marked so Lasso's own keyboard layer ignores it — this Escape is aimed
      // at X's menu, not at Lasso's select mode / picker / selection.
      (ev as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG] = true;
      node.dispatchEvent(ev);
    }
    await settle(80);
  }

  async function openMenu(tweetEl: Element): Promise<Element> {
    // Quoted tweets nest articles; the inner article has no caret — climb out.
    const caret =
      tweetEl.querySelector(DriverSelectors.CARET) ??
      tweetEl.parentElement?.closest(Selectors.TWEET)?.querySelector(DriverSelectors.CARET);
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
    return menu;
  }

  // Rows can render after the menu container; scope matching to the fresh menu
  // so a stray open menu cannot shadow the target tweet.
  const waitForRow = (
    menu: Element,
    match: (el: Element) => boolean,
    timeout: number,
  ): Promise<Element | null> =>
    waitForEl(
      () => [...menu.querySelectorAll(DriverSelectors.MENUITEM)].find(match) ?? null,
      timeout,
      menu,
    );

  async function confirm(required: boolean): Promise<void> {
    const btn = await waitFor(DriverSelectors.CONFIRM, confirmTimeoutMs);
    if (btn) {
      await activate(btn);
      await settle(120);
    } else if (required) {
      throw new Error("Lasso: expected a confirmation sheet but none appeared");
    }
  }

  // X removes the menu once it accepts a row click — "no connected menu
  // container holds a row anymore" is the acceptance signal. Checking the
  // CAPTURED container alone is wrong: X can swap the whole dropdown for a
  // fresh one mid-flight, and a dead container must not read as "accepted".
  const anyMenuRowsOpen = (): boolean =>
    menuContainers().some((m) => m.querySelector(DriverSelectors.MENUITEM));

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
      .flatMap((m) => [...m.querySelectorAll(DriverSelectors.MENUITEM)])
      .find(match) ?? null;

  async function run(
    tweetEl: Element,
    match: (el: Element) => boolean,
    confirmMode: ConfirmMode,
  ): Promise<void> {
    const menu = await openMenu(tweetEl);
    try {
      let row = await waitForRow(menu, match, timeoutMs);
      if (!row) {
        const labels = [...menu.querySelectorAll(DriverSelectors.MENUITEM)]
          .map((r) => (r.textContent ?? "").trim().slice(0, 24))
          .join(" | ");
        throw new Error(`Lasso: target menu item not found (rows: ${labels})`);
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
      if (confirmMode === "always") await confirm(true);
      else if (confirmMode === "if-present") await confirm(false);
    } catch (e) {
      await dismissOpenMenus(); // never leave the user staring at a stuck-open menu
      throw e;
    }
  }

  // After the menu action, X swaps the article for a feedback panel. Require
  // that real X-side effect before reporting success.
  async function notInterested(tweetEl: Element): Promise<void> {
    const cellEl = tweetEl.closest(Selectors.CELL); // capture before X replaces the article
    await run(tweetEl, notInterestedMatch, "never");
    if (!cellEl) return;
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
    const feedback =
      effect !== cellEl
        ? effect
        : await waitForEl(() => findNotInterestedFeedback(cellEl), 800, cellEl);
    if (feedback) {
      await settle(120);
      await activate(feedback);
    }
  }

  return {
    mute: async (t) => {
      await run(t, muteMatch, "if-present");
    },
    notInterested,
    block: async (t) => {
      await run(t, blockMatch, "always");
    },
  };
}
