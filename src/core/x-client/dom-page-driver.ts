import {
  ADD_TO_LISTS_TEXT,
  DriverSelectors,
  Selectors,
  SYNTHETIC_EVENT_FLAG,
} from "@/content/selectors";
import type { TweetAuthor } from "@/core/selection-store";
import * as tweetRead from "@/core/tweet-read";

import type { PageDriver } from "./page-driver";
import type { XList } from "./types";

const click = (el: Element): void => (el as HTMLElement).click();
const textOf = (el: Element): string => el.textContent as string;

/**
 * Real PageDriver that automates X's sanctioned "Add/remove from Lists" UI
 * (ADR-0001/0005). This is the live-DOM integration boundary — its orchestration
 * is unit-tested via a fake PageDriver in dom-api.test.ts; the selectors here must
 * be verified live (blueprint §8). Human-paced settle delays keep it assistive.
 */
export interface DomPageDriverOptions {
  doc?: Document;
  timeoutMs?: number;
  settle?: (ms: number) => Promise<void>;
}

export function createDomPageDriver(opts: DomPageDriverOptions = {}): PageDriver {
  const doc = opts.doc ?? document;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const settle = opts.settle ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let activeDialog: Element | null = null;

  function findAuthorCaret(screenName: string): Element | null {
    for (const article of doc.querySelectorAll(Selectors.TWEET)) {
      const author = tweetRead.author(article);
      if (author?.screenName.toLowerCase() === screenName.toLowerCase()) {
        return article.querySelector(DriverSelectors.CARET);
      }
    }
    return null;
  }

  function rows(): HTMLElement[] {
    if (!activeDialog?.isConnected) return [];
    return [...activeDialog.querySelectorAll(DriverSelectors.MENUITEM)] as HTMLElement[];
  }

  function rowHasName(row: HTMLElement, name: string): boolean {
    const visibleName = name.trim();
    return (
      textOf(row).trim() === visibleName ||
      [...row.querySelectorAll("*")].some((child) => textOf(child).trim() === visibleName)
    );
  }

  function rowListIds(row: HTMLElement): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const element of [row, ...row.querySelectorAll("*")]) {
      const dataId = element.getAttribute("data-list-id")?.trim();
      if (dataId) ids.add(dataId);

      const href = element.getAttribute("href");
      if (!href) continue;
      try {
        const path = new URL(href, doc.location.href).pathname;
        const match = /^\/i\/lists\/([^/]+)(?:\/|$)/.exec(path);
        if (match?.[1]) ids.add(decodeURIComponent(match[1]));
      } catch {
        // A malformed link is not an identity signal. Name fallback remains safe.
      }
    }
    return ids;
  }

  function rowFor(list: XList): HTMLElement {
    const available = rows();
    const byId = available.filter((row) => rowListIds(row).has(list.id));
    if (byId.length === 1) return byId[0]!;
    if (byId.length > 1) {
      throw new Error(`Lasso: list "${list.name}" (${list.id}) is ambiguous in dialog`);
    }

    const byName = available.filter((row) => rowHasName(row, list.name));
    if (byName.length > 1) {
      throw new Error(`Lasso: list "${list.name}" (${list.id}) is ambiguous in dialog`);
    }
    const only = byName[0];
    if (only && rowListIds(only).size === 0) return only;
    throw new Error(`Lasso: list "${list.name}" (${list.id}) not found in dialog`);
  }

  function snapshot(selector: string): ReadonlySet<Element> {
    return new Set(doc.querySelectorAll(selector));
  }

  function waitForFresh(selector: string, existing: ReadonlySet<Element>): Promise<Element> {
    const fresh = (): Element | undefined =>
      [...doc.querySelectorAll(selector)].find((candidate) => !existing.has(candidate));
    const immediate = fresh();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Lasso: timed out waiting for ${selector}`));
      }, timeoutMs);
      const obs = new MutationObserver(() => {
        const el = fresh();
        if (el) {
          clearTimeout(timer);
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(doc.body, { childList: true, subtree: true });
    });
  }

  async function dismissOpenMenus(): Promise<void> {
    if (doc.querySelector(DriverSelectors.MENU) === null) return;
    const init = { key: "Escape", bubbles: true, cancelable: true, composed: true };
    const Event = doc.defaultView?.KeyboardEvent ?? KeyboardEvent;
    for (const node of [doc, doc.body]) {
      const event = new Event("keydown", init);
      (event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG] = true;
      node.dispatchEvent(event);
    }
    await settle(80);
  }

  return {
    async openListsDialog(author: TweetAuthor) {
      const caret = findAuthorCaret(author.screenName);
      if (!caret) throw new Error(`Lasso: no visible tweet for @${author.screenName}`);
      await dismissOpenMenus();
      const priorMenus = snapshot(DriverSelectors.MENU);
      click(caret);
      const menu = await waitForFresh(DriverSelectors.MENU, priorMenus);
      const item = [...menu.querySelectorAll(DriverSelectors.MENUITEM)].find((el) =>
        ADD_TO_LISTS_TEXT.test(textOf(el)),
      );
      if (!item) throw new Error("Lasso: 'Add/remove from Lists' menu item not found");
      await settle(120);
      const priorDialogs = snapshot(DriverSelectors.DIALOG);
      click(item);
      activeDialog = await waitForFresh(DriverSelectors.DIALOG, priorDialogs);
      await settle(120);
    },
    async isChecked(list: XList) {
      const row = rowFor(list);
      const box = row.querySelector(DriverSelectors.CHECKBOX);
      return box?.getAttribute("aria-checked") === "true";
    },
    async toggleList(list: XList) {
      const row = rowFor(list);
      click(row);
      await settle(120);
    },
    async commit() {
      const save = activeDialog?.querySelector(DriverSelectors.SAVE);
      if (save) click(save);
      await settle(120);
    },
    async close() {
      doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(80);
    },
  };
}
