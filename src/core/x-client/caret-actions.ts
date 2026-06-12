import {
  DriverSelectors,
  MUTE_ICON_PATH_PREFIX,
  MUTE_TEXT,
  NOT_INTERESTED_ICON_PATH_PREFIX,
  NOT_INTERESTED_TEXT,
  Selectors,
  SHOW_FEWER_TEXT,
  UNDO_TEXT,
} from "@/content/selectors";

const textOf = (el: Element): string => el.textContent as string;

const eventView = (el: Element): Window => el.ownerDocument.defaultView ?? window;

const elementCenter = (el: Element): { x: number; y: number } => {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

const dispatchMouse = (el: Element, type: string, x: number, y: number): void => {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      view: eventView(el),
    }),
  );
};

const dispatchPointer = (el: Element, type: string, x: number, y: number): void => {
  const view = eventView(el);
  type PointerEventConstructor = new (
    type: string,
    eventInitDict?: PointerEventInit,
  ) => PointerEvent;
  const PointerEventCtor = (view as Window & { PointerEvent?: PointerEventConstructor })
    .PointerEvent;
  if (typeof PointerEventCtor !== "function") return;
  el.dispatchEvent(
    new PointerEventCtor(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      buttons: type.endsWith("down") ? 1 : 0,
      button: 0,
      view,
    }),
  );
};

const activate = (el: Element): void => {
  const target = el as HTMLElement;
  target.scrollIntoView?.({ block: "center", inline: "center" });
  target.focus?.({ preventScroll: true });
  const { x, y } = elementCenter(el);
  dispatchPointer(el, "pointerover", x, y);
  dispatchMouse(el, "mouseover", x, y);
  dispatchPointer(el, "pointermove", x, y);
  dispatchMouse(el, "mousemove", x, y);
  dispatchPointer(el, "pointerdown", x, y);
  dispatchMouse(el, "mousedown", x, y);
  dispatchPointer(el, "pointerup", x, y);
  dispatchMouse(el, "mouseup", x, y);
  dispatchMouse(el, "click", x, y);
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
 * The follow-up panel after "not interested" — plain buttons outside the (now
 * hidden) article: [undo, show fewer from this user, irrelevant]. Prefer the
 * localized "show fewer" text; fall back to position 1, never the undo button.
 */
function findShowFewer(cellEl: Element): Element | null {
  const outside = [...cellEl.querySelectorAll('button, [role="button"]')].filter(
    (b) => !b.closest("article"),
  );
  const byText = outside.find((b) => SHOW_FEWER_TEXT.test(textOf(b)));
  if (byText) return byText;
  const positional = outside.length >= 3 ? (outside[1] as Element) : null;
  if (!positional) return null;
  if (UNDO_TEXT.test(textOf(positional))) return null;
  return positional;
}

const menuForRow = (row: Element, fallback: Element): Element =>
  row.closest(`${DriverSelectors.DROPDOWN}, ${DriverSelectors.MENU}`) ?? fallback;

const actionCompleted = (menu: Element, row: Element): boolean =>
  !menu.isConnected || !row.isConnected;

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

  const waitFor = (selector: string, timeout: number): Promise<Element | null> =>
    waitForEl(() => doc.querySelector(selector), timeout, doc.body);

  async function openMenu(tweetEl: Element): Promise<Element> {
    // Quoted tweets nest articles; the inner article has no caret — climb out.
    const caret =
      tweetEl.querySelector(DriverSelectors.CARET) ??
      tweetEl.parentElement?.closest(Selectors.TWEET)?.querySelector(DriverSelectors.CARET);
    if (!caret) throw new Error("Lasso: caret button not found on the focused tweet");
    activate(caret);
    const menu = await waitFor(`${DriverSelectors.DROPDOWN}, ${DriverSelectors.MENU}`, timeoutMs);
    if (!menu) throw new Error("Lasso: caret menu did not open");
    return menu;
  }

  const ROW_SELECTOR = `${DriverSelectors.DROPDOWN} ${DriverSelectors.MENUITEM}, ${DriverSelectors.MENU} ${DriverSelectors.MENUITEM}`;

  // Rows can render after the menu container, and a stray open menu can shadow the
  // right one — so scan all menu rows document-wide until one matches.
  const waitForRow = (match: (el: Element) => boolean, timeout: number): Promise<Element | null> =>
    waitForEl(() => [...doc.querySelectorAll(ROW_SELECTOR)].find(match) ?? null, timeout, doc.body);

  async function confirm(required: boolean): Promise<void> {
    const btn = await waitFor(DriverSelectors.CONFIRM, confirmTimeoutMs);
    if (btn) {
      activate(btn);
      await settle(120);
    } else if (required) {
      throw new Error("Lasso: expected a confirmation sheet but none appeared");
    }
  }

  async function run(
    tweetEl: Element,
    match: (el: Element) => boolean,
    confirmMode: ConfirmMode,
  ): Promise<{ menu: Element; row: Element }> {
    const openedMenu = await openMenu(tweetEl);
    const row = await waitForRow(match, timeoutMs);
    if (!row) {
      const labels = [...doc.querySelectorAll(ROW_SELECTOR)]
        .map((r) => textOf(r).trim().slice(0, 24))
        .join(" | ");
      throw new Error(`Lasso: target menu item not found (rows: ${labels})`);
    }
    const menu = menuForRow(row, openedMenu);
    await settle(100);
    activate(row);
    if (confirmMode === "always") await confirm(true);
    else if (confirmMode === "if-present") await confirm(false);
    return { menu, row };
  }

  // After the menu action, X swaps the article for a feedback panel; clicking
  // "show fewer from this user" there is what fully collapses the post.
  async function notInterested(tweetEl: Element): Promise<void> {
    const cellEl = tweetEl.closest(Selectors.CELL); // capture before X replaces the article
    const { menu, row } = await run(tweetEl, notInterestedMatch, "never");
    if (!cellEl) {
      await waitForEl(
        () => (actionCompleted(menu, row) ? doc.documentElement : null),
        confirmTimeoutMs,
        doc.body,
      );
      if (!actionCompleted(menu, row)) {
        throw new Error("Lasso: not-interested menu item did not activate");
      }
      return;
    }
    await waitForEl(() => findShowFewer(cellEl), confirmTimeoutMs, doc.body);
    const fewer = findShowFewer(cellEl);
    if (!actionCompleted(menu, row) && !fewer) {
      throw new Error("Lasso: not-interested menu item did not activate");
    }
    if (fewer) {
      await settle(120);
      activate(fewer);
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
