import type { TweetAuthor } from "@/core/selection-store";

import type { PageDriver } from "./lib/page-driver";
import { XApiError, type XList } from "./types";

// page-driver is private plumbing (lib/); intra-package code imports it directly.
// This re-export exists so co-located tests can reach the contract through an
// entry — the boundary gate forbids tests from importing a package's lib/.
export type { PageDriver } from "./lib/page-driver";

const click = (el: Element): void => (el as HTMLElement).click();
const textOf = (el: Element): string => el.textContent as string;
const MENU = '[role="menu"]';
const MENUITEM = '[role="menuitem"]';
const DIALOG = '[role="dialog"]';
const CHECKBOX = '[role="checkbox"], input[type="checkbox"]';
const SAVE = '[data-testid="confirmationSheetConfirm"]';
const ADD_TO_LISTS_TEXT = /add\s*\/\s*remove.*lists|add to list/i;

/**
 * Real PageDriver that automates X's sanctioned "Add/remove from Lists" UI
 * (ADR-0001/0005). This is the live-DOM integration boundary — its orchestration
 * is unit-tested via a fake PageDriver in dom-api.test.ts; the selectors here must
 * be verified live (blueprint §8). Human-paced settle delays keep it assistive.
 */
export interface DomPageDriverOptions {
  /** Finds the visible author's tweet caret in the content-script DOM. */
  findAuthorCaret(screenName: string): Element | null;
  /** Sends an Escape that the content keyboard layer must ignore. */
  dispatchSyntheticEscape(target: Document | Element): void;
  doc?: Document;
  timeoutMs?: number;
  settle?: (ms: number) => Promise<void>;
}

export function createDomPageDriver(opts: DomPageDriverOptions): PageDriver {
  const doc = opts.doc ?? document;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const settle = opts.settle ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let activeDialog: Element | null = null;
  let activeMenu: Element | null = null;

  function assertEnglishInterface(): void {
    const language = doc.documentElement.lang;
    const baseLanguage = language.split("-", 1)[0]?.trim().toLowerCase();
    if (language && baseLanguage !== "en") {
      throw new XApiError(
        "unknown",
        "Lasso's DOM backend currently requires X in English. Switch X's display language to English, or use the REST or GraphQL backend.",
      );
    }
  }

  function rows(): HTMLElement[] {
    if (!activeDialog?.isConnected) return [];
    return [...activeDialog.querySelectorAll(MENUITEM)] as HTMLElement[];
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
      throw new XApiError(
        "unknown",
        `Lasso: list "${list.name}" (${list.id}) is ambiguous in dialog`,
      );
    }

    const byName = available.filter((row) => rowHasName(row, list.name));
    if (byName.length > 1) {
      throw new XApiError(
        "unknown",
        `Lasso: list "${list.name}" (${list.id}) is ambiguous in dialog`,
      );
    }
    const only = byName[0];
    if (only && rowListIds(only).size === 0) return only;
    throw new XApiError("unknown", `Lasso: list "${list.name}" (${list.id}) not found in dialog`);
  }

  function snapshot(selector: string): ReadonlySet<Element> {
    return new Set(doc.querySelectorAll(selector));
  }

  function surfaceSnapshot(selector: string): ReadonlyMap<Element, Element> {
    return new Map(
      [...doc.querySelectorAll(selector)].map((surface) => [
        surface,
        surface.cloneNode(true) as Element,
      ]),
    );
  }

  function waitForChanged(
    selector: string,
    existing: ReadonlyMap<Element, Element>,
  ): Promise<Element> {
    const changed = (): Element | undefined =>
      [...doc.querySelectorAll(selector)].find((candidate) => {
        const before = existing.get(candidate);
        return before === undefined || !before.isEqualNode(candidate);
      });
    const immediate = changed();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        obs.disconnect();
        reject(new XApiError("unknown", `Lasso: timed out waiting for ${selector}`));
      }, timeoutMs);
      const obs = new MutationObserver(() => {
        const el = changed();
        if (el) {
          clearTimeout(timer);
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(doc.body, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    });
  }

  function explicitCommitControl(dialog: Element): Element | undefined {
    return (
      dialog.querySelector(SAVE) ??
      [...dialog.querySelectorAll('button, [role="button"]')].find((candidate) =>
        /^(?:done|save)$/i.test(textOf(candidate).trim()),
      )
    );
  }

  function waitForExplicitCommit(
    dialog: Element,
    priorConfirmations: ReadonlySet<Element>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        observer.disconnect();
        if (error) reject(error);
        else resolve();
      };
      const inspect = (): void => {
        const confirmation = [...doc.querySelectorAll(SAVE)].find(
          (candidate) => !priorConfirmations.has(candidate) && !dialog.contains(candidate),
        );
        if (confirmation) {
          finish(
            new XApiError(
              "unknown",
              "Lasso: an unowned confirmation appeared while committing the Lists dialog",
            ),
          );
          return;
        }
        if (!dialog.isConnected) {
          finish();
        }
      };
      const timer = setTimeout(
        () =>
          finish(
            new XApiError(
              "unknown",
              "Timed out waiting for X to close the Lists dialog after explicit commit",
            ),
          ),
        timeoutMs,
      );
      const observer = new MutationObserver(inspect);
      observer.observe(doc.body, { childList: true, subtree: true });
      inspect();
    });
  }

  function hasUnknownCommitControl(dialog: Element): boolean {
    return [...dialog.querySelectorAll('button, [role="button"]')].some((control) => {
      if (control.closest(MENUITEM)) return false;
      return !/^(?:close|cancel|back)$/i.test(textOf(control).trim());
    });
  }

  function listsMenuItem(menu: Element): Element | undefined {
    return [...menu.querySelectorAll(MENUITEM)].find((el) => ADD_TO_LISTS_TEXT.test(textOf(el)));
  }

  async function dismissOpenMenus(): Promise<void> {
    // This is the one deliberate global dismissal: it runs before the caret
    // click and fresh-surface snapshot, so an existing menu cannot be mistaken
    // for this attempt's menu. Later cleanup targets only owned surfaces.
    if (doc.querySelector(MENU) === null) return;
    for (const node of [doc, doc.body]) {
      opts.dispatchSyntheticEscape(node);
    }
    await settle(80);
  }

  return {
    async openListsDialog(author: TweetAuthor) {
      assertEnglishInterface();
      const caret = opts.findAuthorCaret(author.screenName);
      if (!caret) {
        throw new XApiError("unknown", `Lasso: no visible tweet for @${author.screenName}`);
      }
      await dismissOpenMenus();
      const priorMenus = surfaceSnapshot(MENU);
      click(caret);
      const menu = await waitForChanged(MENU, priorMenus);
      activeMenu = menu;
      const item = listsMenuItem(menu);
      if (!item) {
        throw new XApiError("unknown", "Lasso: 'Add/remove from Lists' menu item not found");
      }
      await settle(120);
      if (!menu.isConnected) {
        throw new XApiError(
          "unknown",
          "Lasso: caret menu changed before its Lists item could be used",
        );
      }
      const currentItem = listsMenuItem(menu);
      if (!currentItem?.isConnected) {
        throw new XApiError(
          "unknown",
          "Lasso: 'Add/remove from Lists' menu item changed before use",
        );
      }
      const priorDialogs = surfaceSnapshot(DIALOG);
      click(currentItem);
      activeDialog = await waitForChanged(DIALOG, priorDialogs);
      activeMenu = null;
      await settle(120);
    },
    async isChecked(list: XList) {
      const row = rowFor(list);
      const box = row.querySelector(CHECKBOX);
      if (box?.matches('input[type="checkbox"]')) return (box as HTMLInputElement).checked;
      const ariaChecked =
        box?.getAttribute("aria-checked") ??
        row.getAttribute("aria-checked") ??
        row.querySelector("[aria-checked]")?.getAttribute("aria-checked");
      if (ariaChecked === "true") return true;
      if (ariaChecked === "false") return false;
      throw new XApiError("unknown", `Lasso: list "${list.name}" has no readable checked state`);
    },
    async toggleList(list: XList) {
      const row = rowFor(list);
      click(row);
      await settle(120);
    },
    async commit() {
      await settle(120);
      const dialog = activeDialog;
      if (!dialog?.isConnected) {
        throw new XApiError("unknown", "Lists dialog closed before its change could be committed");
      }
      const control = explicitCommitControl(dialog);
      if (!control) {
        if (hasUnknownCommitControl(dialog)) {
          throw new XApiError("unknown", "Lasso: Lists dialog has an unrecognized commit control");
        }
        return "immediate";
      }

      const priorConfirmations = snapshot(SAVE);
      click(control);
      await waitForExplicitCommit(dialog, priorConfirmations);
      return "explicit";
    },
    async close() {
      const surface = activeDialog?.isConnected
        ? activeDialog
        : activeMenu?.isConnected
          ? activeMenu
          : null;
      activeDialog = null;
      activeMenu = null;
      if (!surface) return;
      opts.dispatchSyntheticEscape(surface);
      await settle(80);
    },
  };
}
