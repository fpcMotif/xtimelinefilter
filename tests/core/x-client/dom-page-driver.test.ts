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

describe("createDomPageDriver (synthetic x.com)", () => {
  const driver = () =>
    createDomPageDriver({ doc: document, settle: async () => {}, timeoutMs: 1000 });

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

  it("throws a clear error when the author has no visible tweet", async () => {
    document.body.innerHTML = "";
    await expect(driver().openListsDialog({ screenName: "ghost" })).rejects.toThrow(
      /no visible tweet/i,
    );
  });
});
