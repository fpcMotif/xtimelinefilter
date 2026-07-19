import { afterEach, describe, expect, it } from "vitest";

import { SYNTHETIC_EVENT_FLAG } from "@/content/selectors";
import { createDomPageDriver } from "@/core/x-client/dom-page-driver";
import type { XList } from "@/core/x-client/types";

const list = (name: string, id = name): XList => ({ id, name });
const RESEARCH = list("Research", "1");
const FRIENDS = list("Friends", "2");

/**
 * Drives a SYNTHETIC x.com-shaped DOM (caret → menu → Lists dialog) to cover the
 * driver's traversal logic. The real selectors still need live DevTools
 * confirmation (blueprint §8) — this guards the logic against regressions.
 */
function setupSyntheticX(doc: Document): void {
  doc.body.innerHTML = `
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name">
        <div><a href="/jack"><span>Jack</span></a></div>
        <div><a href="/jack/status/1"><time>1h</time></a></div>
      </div>
      <button data-testid="caret" aria-label="More"></button>
    </article>`;

  const caret = doc.querySelector('[data-testid="caret"]') as HTMLElement;
  caret.addEventListener("click", () => {
    const menu = doc.createElement("div");
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div role="menuitem">Follow @jack</div>
      <div role="menuitem">Add/remove @jack from Lists</div>`;
    doc.body.appendChild(menu);
    const item = [...menu.querySelectorAll('[role="menuitem"]')].find((el) =>
      /lists/i.test(el.textContent ?? ""),
    ) as HTMLElement;
    item.addEventListener("click", () => {
      const dialog = doc.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.innerHTML = `
        <div role="menuitem"><span>Research</span><div role="checkbox" aria-checked="false"></div></div>
        <div role="menuitem"><span>Friends</span><div role="checkbox" aria-checked="true"></div></div>
        <button data-testid="confirmationSheetConfirm">Save</button>`;
      for (const row of dialog.querySelectorAll('[role="menuitem"]')) {
        row.addEventListener("click", () => {
          const box = row.querySelector('[role="checkbox"]') as HTMLElement;
          box.setAttribute(
            "aria-checked",
            box.getAttribute("aria-checked") === "true" ? "false" : "true",
          );
        });
      }
      doc.body.appendChild(dialog);
    });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

const driver = () =>
  createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 1000 });

describe("createDomPageDriver (synthetic x.com)", () => {
  it("throws before a dialog opens or after its dialog disconnects", async () => {
    setupSyntheticX(document);
    const d = driver();
    await expect(d.isChecked(RESEARCH)).rejects.toThrow(/not found/);
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[role="dialog"]')?.remove();
    await expect(d.isChecked(RESEARCH)).rejects.toThrow(/not found/);
  });

  it("opens the Lists dialog from a tweet's caret", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
  });

  it("ignores surviving menus and dialogs from another author", async () => {
    setupSyntheticX(document);
    let staleMenuItemClicks = 0;
    let staleRowToggles = 0;
    let documentEscapes = 0;
    let bodyEscapes = 0;
    const onDocumentEscape = (event: Event) => {
      if (
        event.type === "keydown" &&
        (event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]
      ) {
        documentEscapes++;
      }
    };
    const onBodyEscape = (event: Event) => {
      if (
        event.type === "keydown" &&
        (event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]
      ) {
        bodyEscapes++;
      }
    };
    document.addEventListener("keydown", onDocumentEscape);
    document.body.addEventListener("keydown", onBodyEscape);

    const staleMenu = document.createElement("div");
    staleMenu.setAttribute("role", "menu");
    staleMenu.innerHTML = `<div role="menuitem">Add/remove @other from Lists</div>`;
    (staleMenu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
      staleMenuItemClicks++;
    });

    const staleDialog = document.createElement("div");
    staleDialog.setAttribute("role", "dialog");
    staleDialog.innerHTML =
      `<div role="menuitem"><span>Research</span>` +
      `<div role="checkbox" aria-checked="false"></div></div>`;
    const staleRow = staleDialog.querySelector('[role="menuitem"]') as HTMLElement;
    staleRow.addEventListener("click", () => {
      staleRowToggles++;
      const box = staleRow.querySelector('[role="checkbox"]') as HTMLElement;
      box.setAttribute("aria-checked", "true");
    });
    document.body.append(staleMenu, staleDialog);

    try {
      const d = driver();
      await d.openListsDialog({ screenName: "jack" });
      await d.toggleList(RESEARCH);

      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const targetDialog = dialogs.find((dialog) => dialog !== staleDialog) as HTMLElement;
      expect(targetDialog).toBeTruthy();
      expect(targetDialog.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe(
        "true",
      );
      expect(staleMenuItemClicks).toBe(0);
      expect(staleRowToggles).toBe(0);
      expect(staleRow.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe(
        "false",
      );
      expect(documentEscapes).toBe(2);
      expect(bodyEscapes).toBe(1);
    } finally {
      document.removeEventListener("keydown", onDocumentEscape);
      document.body.removeEventListener("keydown", onBodyEscape);
    }
  });

  it("reads and toggles row checked state", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
    expect(await d.isChecked(FRIENDS)).toBe(true);
    await d.toggleList(RESEARCH);
    expect(await d.isChecked(RESEARCH)).toBe(true);
    await d.commit(); // clicks Save without throwing
  });

  it("treats a row without a checkbox as unchecked", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.insertAdjacentHTML("beforeend", `<div role="menuitem">No checkbox</div>`);
    expect(await d.isChecked(list("No checkbox"))).toBe(false);
  });

  it("throws for missing rows", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    await expect(d.isChecked(list("Missing"))).rejects.toThrow(/not found/);
    await expect(d.toggleList(list("Missing"))).rejects.toThrow(/not found/);
  });

  it("matches the exact visible list name, not a longer row", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.insertAdjacentHTML(
      "afterbegin",
      `<div role="menuitem"><span>Research notes</span><div role="checkbox" aria-checked="true"></div></div>`,
    );

    expect(await d.isChecked(list(" Research ", "1"))).toBe(false);
    await d.toggleList(RESEARCH);
    expect(await d.isChecked(RESEARCH)).toBe(true);
    expect(await d.isChecked(list("Research notes", "3"))).toBe(true);
  });

  it("uses a data-list-id to resolve duplicate names", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem" data-list-id="1"><span>Research</span></div>
      <div role="menuitem" data-list-id="2"><span>Research</span></div>`;
    const [first, second] = dialog.querySelectorAll('[role="menuitem"]');
    let firstClicks = 0;
    let secondClicks = 0;
    first?.addEventListener("click", () => firstClicks++);
    second?.addEventListener("click", () => secondClicks++);

    await d.toggleList(list("Research", "2"));

    expect(firstClicks).toBe(0);
    expect(secondClicks).toBe(1);
  });

  it("uses an /i/lists link to resolve duplicate names", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem"><a href="/i/lists/1">Research</a><div role="checkbox" aria-checked="false"></div></div>
      <div role="menuitem"><a href="https://x.com/i/lists/2">Research</a><div role="checkbox" aria-checked="true"></div></div>`;

    expect(await d.isChecked(list("Research", "2"))).toBe(true);
  });

  it("throws instead of choosing the first duplicate name", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem"><span>Research</span></div>
      <div role="menuitem"><span>Research</span></div>`;

    await expect(d.isChecked(RESEARCH)).rejects.toThrow(/ambiguous/);
    await expect(d.toggleList(RESEARCH)).rejects.toThrow(/ambiguous/);
  });

  it("does not use a name when the sole row names another List id", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `<div role="menuitem" data-list-id="2"><span>Research</span></div>`;

    await expect(d.isChecked(RESEARCH)).rejects.toThrow(/not found/);
  });

  it("commits harmlessly when the Save button is absent and closes with Escape", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
    let escaped = false;
    document.body.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") escaped = true;
    });
    await d.commit();
    await d.close();
    expect(escaped).toBe(true);
  });

  it("throws a clear error when the author has no visible tweet", async () => {
    document.body.innerHTML = "";
    await expect(driver().openListsDialog({ screenName: "ghost" })).rejects.toThrow(
      /no visible tweet/i,
    );
  });

  it("skips tweets whose author cannot be extracted while looking for the caret", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet"><button data-testid="caret"></button></article>
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    const caret = document.querySelectorAll('[data-testid="caret"]')[1] as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Add/remove @jack from Lists</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        document.body.appendChild(dialog);
      });
      document.body.appendChild(menu);
    });
    await driver().openListsDialog({ screenName: "jack" });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("throws when the caret menu never opens", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    const d = createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 5 });
    await expect(d.openListsDialog({ screenName: "jack" })).rejects.toThrow(/timed out/);
  });

  it("throws when the Lists menu item is absent", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    document.querySelector("button")?.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Follow @jack</div>`;
      document.body.appendChild(menu);
    });
    const d = createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 50 });
    await expect(d.openListsDialog({ screenName: "jack" })).rejects.toThrow(/menu item/);
  });

  it("waits for asynchronously inserted menus and dialogs", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => document.body.appendChild(document.createElement("span")), 1);
      setTimeout(() => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML = `<div role="menuitem">Add/remove @jack from Lists</div>`;
        (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
          setTimeout(() => document.body.appendChild(document.createElement("span")), 1);
          setTimeout(() => {
            const dialog = document.createElement("div");
            dialog.setAttribute("role", "dialog");
            dialog.innerHTML = `<div role="menuitem">Research</div>`;
            document.body.appendChild(dialog);
          }, 5);
        });
        document.body.appendChild(menu);
      }, 5);
    });
    const d = createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 100 });
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
  });

  it("works with default document, timeout, and settle options", async () => {
    setupSyntheticX(document);
    const d = createDomPageDriver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(FRIENDS)).toBe(true);
  });

  it("uses the global KeyboardEvent when a detached document has no default view", async () => {
    const doc = document.implementation.createHTMLDocument("detached");
    setupSyntheticX(doc);
    const staleMenu = doc.createElement("div");
    staleMenu.setAttribute("role", "menu");
    doc.body.appendChild(staleMenu);
    const d = createDomPageDriver({ doc, settle: async () => {}, timeoutMs: 100 });

    await d.openListsDialog({ screenName: "jack" });

    expect(await d.isChecked(RESEARCH)).toBe(false);
  });
});
