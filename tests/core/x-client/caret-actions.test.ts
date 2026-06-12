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
        menu.remove();
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

  it("mute can match by localized text when the icon is absent", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Mute @jack</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("mute-text");
        menu.remove();
      });
      document.body.appendChild(menu);
    });
    await actions().mute(tweet());
    expect(clicked).toEqual(["mute-text"]);
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

  it("block can match by row text and fails when the required confirm is absent", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">  Block @jack</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("block-text");
        menu.remove();
      });
      document.body.appendChild(menu);
    });
    const a = createCaretActions({
      doc: document,
      settle: async () => {},
      timeoutMs: 60,
      confirmTimeoutMs: 20,
    });
    await expect(a.block(tweet())).rejects.toThrow(/confirmation sheet/);
    expect(clicked).toEqual(["block-text"]);
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
        row.addEventListener("click", () => {
          clicked.push("late-not");
          menu.remove();
        });
        menu.appendChild(row);
      }, 30);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["late-not"]);
  });

  it("keeps waiting through unrelated menu mutations before the target row appears", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
      setTimeout(() => menu.appendChild(document.createElement("span")), 5);
      setTimeout(() => {
        const row = document.createElement("div");
        row.setAttribute("role", "menuitem");
        row.textContent = "Not interested in this post";
        row.addEventListener("click", () => {
          clicked.push("after-noise");
          menu.remove();
        });
        menu.appendChild(row);
      }, 15);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["after-noise"]);
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
        menu.remove();
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
        menu.remove();
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

  it("does not use the positional show-fewer fallback when that slot is undo", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const cell = document.querySelector('[data-testid="cellInnerDiv"]') as Element;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("not");
        menu.remove();
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button>Something</button><button data-k="undo">Undo</button><button>Other</button></div>`,
        );
        (cell.querySelector('[data-k="undo"]') as HTMLElement).addEventListener("click", () =>
          clicked.push("undo"),
        );
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["not"]);
  });

  it("notInterested activates rows that require a mouseup sequence", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      const row = menu.querySelector('[role="menuitem"]') as HTMLElement;
      row.addEventListener("mouseup", () => {
        clicked.push("mouse-not");
        menu.remove();
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["mouse-not"]);
  });

  it("does not silently resolve when the not-interested row stays open", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      document.body.appendChild(menu);
    });
    const a = createCaretActions({
      doc: document,
      settle: async () => {},
      timeoutMs: 60,
      confirmTimeoutMs: 20,
    });
    await expect(a.notInterested(document.querySelector("article") as Element)).rejects.toThrow(
      /did not activate/,
    );
  });

  it("does not silently resolve outside a cell when the row stays open", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      document.body.appendChild(menu);
    });
    const a = createCaretActions({
      doc: document,
      settle: async () => {},
      timeoutMs: 60,
      confirmTimeoutMs: 20,
    });
    await expect(a.notInterested(tweet())).rejects.toThrow(/did not activate/);
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

  it("throws when the caret menu never opens", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 20 });
    await expect(a.mute(tweet())).rejects.toThrow(/menu did not open/);
  });

  it("uses default dependencies and still activates without PointerEvent support", async () => {
    const originalPointerEvent = window.PointerEvent;
    try {
      (window as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent = undefined;
      document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
      const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
      caret.addEventListener("click", () => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
        (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
          clicked.push("default-not");
          menu.remove();
        });
        document.body.appendChild(menu);
      });
      await createCaretActions().notInterested(tweet());
      expect(clicked).toEqual(["default-not"]);
    } finally {
      (window as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent =
        originalPointerEvent;
    }
  });

  it("falls back to the global window for detached documents", async () => {
    const doc = document.implementation.createHTMLDocument("detached");
    doc.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = doc.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = doc.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      const row = menu.querySelector('[role="menuitem"]') as HTMLElement & {
        closest: Element["closest"];
      };
      row.closest = () => null;
      row.addEventListener("click", () => {
        clicked.push("detached-not");
        menu.remove();
      });
      doc.body.appendChild(menu);
    });
    const a = createCaretActions({ doc, settle: async () => {}, timeoutMs: 60 });
    await a.notInterested(doc.querySelector("article") as Element);
    expect(clicked).toEqual(["detached-not"]);
  });
});
