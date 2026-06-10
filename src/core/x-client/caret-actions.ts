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

const click = (el: Element): void => (el as HTMLElement).click();

const muteMatch = (el: Element): boolean =>
  !!el.querySelector(`svg path[d^="${MUTE_ICON_PATH_PREFIX}"]`) ||
  MUTE_TEXT.test(el.textContent ?? "");
const blockMatch = (el: Element): boolean =>
  !!el.querySelector(DriverSelectors.BLOCK) ||
  el.getAttribute("data-testid") === "block" ||
  /^\s*block/i.test(el.textContent ?? "");
const notInterestedMatch = (el: Element): boolean =>
  !!el.querySelector(`svg path[d^="${NOT_INTERESTED_ICON_PATH_PREFIX}"]`) ||
  NOT_INTERESTED_TEXT.test(el.textContent ?? "");

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
    const timer = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, timeout);
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        clearTimeout(timer);
        obs.disconnect();
        resolve(el);
      }
    });
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
  const byText = outside.find((b) => SHOW_FEWER_TEXT.test(b.textContent ?? ""));
  if (byText) return byText;
  const positional = outside.length >= 3 ? (outside[1] as Element) : null;
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

  const waitFor = (selector: string, timeout: number): Promise<Element | null> =>
    waitForEl(() => doc.querySelector(selector), timeout, doc.body);

  async function openMenu(tweetEl: Element): Promise<void> {
    // Quoted tweets nest articles; the inner article has no caret — climb out.
    const caret =
      tweetEl.querySelector(DriverSelectors.CARET) ??
      tweetEl.parentElement?.closest(Selectors.TWEET)?.querySelector(DriverSelectors.CARET);
    if (!caret) throw new Error("Lasso: caret button not found on the focused tweet");
    click(caret);
    const menu = await waitFor(`${DriverSelectors.DROPDOWN}, ${DriverSelectors.MENU}`, timeoutMs);
    if (!menu) throw new Error("Lasso: caret menu did not open");
  }

  const ROW_SELECTOR = `${DriverSelectors.DROPDOWN} ${DriverSelectors.MENUITEM}, ${DriverSelectors.MENU} ${DriverSelectors.MENUITEM}`;

  // Rows can render after the menu container, and a stray open menu can shadow the
  // right one — so scan all menu rows document-wide until one matches.
  const waitForRow = (match: (el: Element) => boolean, timeout: number): Promise<Element | null> =>
    waitForEl(() => [...doc.querySelectorAll(ROW_SELECTOR)].find(match) ?? null, timeout, doc.body);

  async function confirm(required: boolean): Promise<void> {
    const btn = await waitFor(DriverSelectors.CONFIRM, confirmTimeoutMs);
    if (btn) {
      click(btn);
      await settle(120);
    } else if (required) {
      throw new Error("Lasso: expected a confirmation sheet but none appeared");
    }
  }

  async function run(
    tweetEl: Element,
    match: (el: Element) => boolean,
    confirmMode: ConfirmMode,
  ): Promise<void> {
    await openMenu(tweetEl);
    const row = await waitForRow(match, timeoutMs);
    if (!row) {
      const labels = [...doc.querySelectorAll(ROW_SELECTOR)]
        .map((r) => (r.textContent ?? "").trim().slice(0, 24))
        .join(" | ");
      throw new Error(`Lasso: target menu item not found (rows: ${labels})`);
    }
    await settle(100);
    click(row);
    if (confirmMode === "always") await confirm(true);
    else if (confirmMode === "if-present") await confirm(false);
  }

  // After the menu action, X swaps the article for a feedback panel; clicking
  // "show fewer from this user" there is what fully collapses the post.
  async function notInterested(tweetEl: Element): Promise<void> {
    const cellEl = tweetEl.closest(Selectors.CELL); // capture before X replaces the article
    await run(tweetEl, notInterestedMatch, "never");
    if (!cellEl) return;
    const fewer = await waitForEl(() => findShowFewer(cellEl), confirmTimeoutMs, cellEl);
    if (fewer) {
      await settle(120);
      click(fewer);
    }
  }

  return {
    mute: (t) => run(t, muteMatch, "if-present"),
    notInterested,
    block: (t) => run(t, blockMatch, "always"),
  };
}
