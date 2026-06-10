import { afterEach, describe, expect, it } from "vitest";

import { MUTE_ICON_PATH_PREFIX } from "@/content/selectors";
import { createCaretActions } from "@/core/x-client/caret-actions";

const clicked: string[] = [];

function setup(doc: Document): void {
  doc.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
  const caret = doc.querySelector('[data-testid="caret"]') as HTMLElement;
  caret.addEventListener("click", () => {
    const menu = doc.createElement("div");
    menu.setAttribute("data-testid", "Dropdown");
    menu.innerHTML = `
      <div role="menuitem" data-k="not">Not interested in this post</div>
      <div role="menuitem" data-k="mute"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg><span>Mute</span></div>
      <div role="menuitem" data-k="block" data-testid="block">Block @jack</div>`;
    for (const row of menu.querySelectorAll('[role="menuitem"]')) {
      row.addEventListener("click", () => {
        clicked.push(row.getAttribute("data-k") as string);
        if (row.getAttribute("data-k") === "block") {
          const c = doc.createElement("button");
          c.setAttribute("data-testid", "confirmationSheetConfirm");
          c.addEventListener("click", () => clicked.push("confirm"));
          doc.body.appendChild(c);
        }
      });
    }
    doc.body.appendChild(menu);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  clicked.length = 0;
});

const actions = () =>
  createCaretActions({
    doc: document,
    settle: async () => {},
    timeoutMs: 1000,
    confirmTimeoutMs: 50,
  });
const tweet = () => document.querySelector("article") as Element;

describe("createCaretActions", () => {
  it("mute clicks the Mute row (matched by icon path), no confirm needed", async () => {
    setup(document);
    await actions().mute(tweet());
    expect(clicked).toEqual(["mute"]);
  });

  it("notInterested clicks the not-interested row", async () => {
    setup(document);
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not"]);
  });

  it("block clicks Block then confirms the sheet", async () => {
    setup(document);
    await actions().block(tweet());
    expect(clicked).toEqual(["block", "confirm"]);
  });

  it("throws when the focused tweet has no caret", async () => {
    document.body.innerHTML = `<article data-testid="tweet"></article>`;
    await expect(actions().mute(tweet())).rejects.toThrow(/caret/i);
  });

  it("falls back to the outer article's caret for nested quoted tweets", async () => {
    setup(document);
    const outer = document.querySelector("article") as Element;
    const inner = document.createElement("article");
    inner.setAttribute("data-testid", "tweet");
    outer.appendChild(inner);
    await actions().notInterested(inner);
    expect(clicked).toEqual(["not"]);
  });

  it("waits for rows that render after the menu container", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu); // container first, rows later (like X)
      setTimeout(() => {
        const row = document.createElement("div");
        row.setAttribute("role", "menuitem");
        row.textContent = "Not interested in this post";
        row.addEventListener("click", () => clicked.push("late-not"));
        menu.appendChild(row);
      }, 30);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["late-not"]);
  });

  it("notInterested clicks the show-fewer follow-up so the post collapses", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const cell = document.querySelector('[data-testid="cellInnerDiv"]') as Element;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      const row = menu.querySelector('[role="menuitem"]') as HTMLElement;
      row.addEventListener("click", () => {
        clicked.push("not");
        // X swaps in the feedback panel (zh-Hant labels, like the live DOM)
        setTimeout(() => {
          cell.insertAdjacentHTML(
            "beforeend",
            `<div><button>復原</button><button data-k="fewer">減少顯示 @x 的貼文</button><button>這是不相關的貼文</button></div>`,
          );
          (cell.querySelector('[data-k="fewer"]') as HTMLElement).addEventListener("click", () =>
            clicked.push("fewer"),
          );
        }, 10);
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["not", "fewer"]);
  });

  it("show-fewer position fallback never clicks the undo button", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const cell = document.querySelector('[data-testid="cellInnerDiv"]') as Element;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("not");
        // unknown locale: no text matches — position 1 must win, position 0 never
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button data-k="undo">Rückgängig</button><button data-k="fewer">Weniger anzeigen</button><button>Irrelevant</button></div>`,
        );
        for (const b of cell.querySelectorAll("[data-k]")) {
          b.addEventListener("click", () => clicked.push(b.getAttribute("data-k") as string));
        }
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["not", "fewer"]);
  });

  it("notInterested still resolves when no follow-up panel appears", async () => {
    setup(document);
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not"]);
  });

  it("reports the rows it saw when no row matches", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">跟隨 @someone</div>`;
      document.body.appendChild(menu);
    });
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 60 });
    await expect(a.notInterested(tweet())).rejects.toThrow(/跟隨 @someone/);
  });
});
