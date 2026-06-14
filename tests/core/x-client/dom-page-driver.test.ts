import { afterEach, describe, expect, it } from "vitest";

import { createDomPageDriver } from "@/core/x-client/dom-page-driver";

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
  it("returns no list names before a dialog is open", async () => {
    expect(await driver().listNames()).toEqual([]);
  });

  it("opens the Lists dialog from a tweet's caret and enumerates lists", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.listNames()).toEqual(["Research", "Friends"]);
  });

  it("reads and toggles row checked state", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked("Research")).toBe(false);
    expect(await d.isChecked("Friends")).toBe(true);
    await d.toggleList("Research");
    expect(await d.isChecked("Research")).toBe(true);
    await d.commit(); // clicks Save without throwing
  });

  it("treats a row without a checkbox as unchecked", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.insertAdjacentHTML("beforeend", `<div role="menuitem">No checkbox</div>`);
    expect(await d.isChecked("No checkbox")).toBe(false);
  });

  it("returns false for missing rows and throws when toggling one", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked("Missing")).toBe(false);
    await expect(d.toggleList("Missing")).rejects.toThrow(/not found/);
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
    expect(await d.listNames()).toEqual(["Research"]);
  });

  it("works with default document, timeout, and settle options", async () => {
    setupSyntheticX(document);
    const d = createDomPageDriver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.listNames()).toEqual(["Research", "Friends"]);
  });
});
