import { ADD_TO_LISTS_TEXT, DriverSelectors, Selectors } from "@/content/selectors";
import type { TweetAuthor } from "@/core/selection-store";
import { extractAuthor } from "@/core/tweet-extractor";

import type { PageDriver } from "./page-driver";

const click = (el: Element): void => (el as HTMLElement).click();

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

  function findAuthorCaret(screenName: string): Element | null {
    for (const article of doc.querySelectorAll(Selectors.TWEET)) {
      const author = extractAuthor(article);
      if (author?.screenName.toLowerCase() === screenName.toLowerCase()) {
        return article.querySelector(DriverSelectors.CARET);
      }
    }
    return null;
  }

  function rows(): HTMLElement[] {
    const dialog = doc.querySelector(DriverSelectors.DIALOG);
    if (!dialog) return [];
    return [...dialog.querySelectorAll(DriverSelectors.MENUITEM)] as HTMLElement[];
  }

  function rowByName(name: string): HTMLElement | undefined {
    return rows().find((r) => (r.textContent ?? "").includes(name));
  }

  function waitFor(selector: string): Promise<Element> {
    const existing = doc.querySelector(selector);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Lasso: timed out waiting for ${selector}`));
      }, timeoutMs);
      const obs = new MutationObserver(() => {
        const el = doc.querySelector(selector);
        if (el) {
          clearTimeout(timer);
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(doc.body, { childList: true, subtree: true });
    });
  }

  return {
    async openListsDialog(author: TweetAuthor) {
      const caret = findAuthorCaret(author.screenName);
      if (!caret) throw new Error(`Lasso: no visible tweet for @${author.screenName}`);
      click(caret);
      const menu = await waitFor(DriverSelectors.MENU);
      const item = [...menu.querySelectorAll(DriverSelectors.MENUITEM)].find((el) =>
        ADD_TO_LISTS_TEXT.test(el.textContent ?? ""),
      );
      if (!item) throw new Error("Lasso: 'Add/remove from Lists' menu item not found");
      await settle(120);
      click(item);
      await waitFor(DriverSelectors.DIALOG);
      await settle(120);
    },
    async listNames() {
      return rows().map((r) => (r.textContent ?? "").trim());
    },
    async isChecked(listName: string) {
      const row = rowByName(listName);
      if (!row) return false;
      const box = row.querySelector(DriverSelectors.CHECKBOX);
      return box?.getAttribute("aria-checked") === "true";
    },
    async toggleList(listName: string) {
      const row = rowByName(listName);
      if (!row) throw new Error(`Lasso: list "${listName}" not found in dialog`);
      click(row);
      await settle(120);
    },
    async commit() {
      const save = doc.querySelector(DriverSelectors.SAVE);
      if (save) click(save);
      await settle(120);
    },
    async close() {
      doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle(80);
    },
  };
}
