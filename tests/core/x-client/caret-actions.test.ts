import { afterEach, describe, expect, it } from "vitest";

import { MUTE_ICON_PATH_PREFIX } from "@/content/selectors";
import { createCaretActions } from "@/core/x-client/caret-actions";

const clicked: string[] = [];

// Like live X: an accepted row click removes the menu from the DOM. The new
// driver treats "menu still open" as "X ignored the click" and retries.
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
  document.documentElement.removeAttribute("data-lasso-main-world-activate");
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

  it("notInterested clicks the post-level feedback follow-up so X gets a clear signal", async () => {
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
            `<div><button>復原</button><button data-k="fewer">減少顯示 @x 的貼文</button><button data-k="irrelevant">這是不相關的貼文</button></div>`,
          );
          for (const b of cell.querySelectorAll("[data-k]")) {
            b.addEventListener("click", () => clicked.push(b.getAttribute("data-k") as string));
          }
        }, 10);
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["not", "irrelevant"]);
  });

  it("clicks the feedback button inside X's new testid-less feedback article", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const cell = document.querySelector('[data-testid="cellInnerDiv"]') as Element;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">對此貼文不感興趣</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("not");
        menu.remove();
        // live 2026-06-12: X REPLACES the tweet article with a testid-less
        // article that holds the feedback buttons — they must not be filtered out
        (cell.querySelector('article[data-testid="tweet"]') as Element).remove();
        cell.insertAdjacentHTML(
          "beforeend",
          `<article><button>復原</button><button data-k="fewer">減少顯示 @x 的貼文</button><button data-k="irrelevant">這是不相關的貼文</button></article>`,
        );
        for (const b of cell.querySelectorAll("[data-k]")) {
          b.addEventListener("click", () => clicked.push(b.getAttribute("data-k") as string));
        }
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not", "irrelevant"]);
  });

  it("still clicks the follow-up when the panel renders after the article unmounts", async () => {
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
        (cell.querySelector("article") as Element).remove(); // article unmounts first…
        setTimeout(() => {
          // …the panel lands a beat later (seen live 2026-06-12)
          cell.insertAdjacentHTML(
            "beforeend",
            `<article><button>復原</button><button>減少顯示 @x 的貼文</button><button data-k="irrelevant">這是不相關的貼文</button></article>`,
          );
          (cell.querySelector('[data-k="irrelevant"]') as HTMLElement).addEventListener(
            "click",
            () => clicked.push("irrelevant"),
          );
        }, 20);
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not", "irrelevant"]);
  });

  it("feedback position fallback never clicks the undo button", async () => {
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
        // unknown locale: no text matches — position 2 must win, position 0 never
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button data-k="undo">Rückgängig</button><button data-k="fewer">Weniger anzeigen</button><button data-k="irrelevant">Nicht relevant</button></div>`,
        );
        for (const b of cell.querySelectorAll("[data-k]")) {
          b.addEventListener("click", () => clicked.push(b.getAttribute("data-k") as string));
        }
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(document.querySelector("article") as Element);
    expect(clicked).toEqual(["not", "irrelevant"]);
  });

  it("notInterested fails instead of showing success when X shows no effect", async () => {
    document.body.innerHTML = `<div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("not");
        menu.remove(); // X took the click but the post never updated
      });
      document.body.appendChild(menu);
    });

    await expect(actions().notInterested(tweet())).rejects.toThrow(/not-interested/i);
    expect(clicked).toEqual(["not"]);
  });

  it("re-clicks the row when X ignores the first click (menu stayed open)", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      const row = menu.querySelector('[role="menuitem"]') as HTMLElement;
      let clicks = 0;
      row.addEventListener("click", () => {
        clicked.push("mute");
        if (++clicks >= 2) menu.remove(); // first click swallowed — the live-bug shape
      });
      document.body.appendChild(menu);
    });
    await actions().mute(tweet());
    expect(clicked).toEqual(["mute", "mute"]);
  });

  it("uses the main-world bridge when isolated DOM clicks would be ignored", async () => {
    document.documentElement.setAttribute("data-lasso-main-world-activate", "1");
    window.addEventListener("message", (event) => {
      const data = event.data as {
        channel?: string;
        id?: string;
        requestId?: string;
        type?: string;
      } | null;
      if (
        data?.channel !== "__lasso_x_main_world_activate__" ||
        data.type !== "activate" ||
        !data.id ||
        !data.requestId
      ) {
        return;
      }
      const target = [...document.querySelectorAll("[data-lasso-activate-target]")].find(
        (el) => el.getAttribute("data-lasso-activate-target") === data.id,
      );
      if (target) {
        (target as HTMLElement).click();
        if (target.getAttribute("role") === "menuitem") clicked.push("bridge");
        target.closest('[role="menu"]')?.remove();
      }
      window.postMessage(
        {
          channel: "__lasso_x_main_world_activate__",
          ok: !!target,
          requestId: data.requestId,
          type: "activated",
        },
        "*",
      );
    });

    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      document.body.appendChild(menu);
    });

    await actions().mute(tweet());
    expect(clicked).toEqual(["bridge"]);
  });

  it("dismisses a stale open menu before targeting the focused tweet", async () => {
    document.body.innerHTML = `
      <div data-testid="Dropdown"><div role="menuitem" data-k="stale">Not interested in this post</div></div>
      <div data-testid="cellInnerDiv"><article data-testid="tweet"><button data-testid="caret"></button></article></div>`;
    const stale = document.querySelector('[data-k="stale"]') as HTMLElement;
    stale.addEventListener("click", () => clicked.push("stale"));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") stale.closest('[data-testid="Dropdown"]')?.remove();
    });

    const cell = document.querySelector('[data-testid="cellInnerDiv"]') as Element;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("data-testid", "Dropdown");
      menu.innerHTML = `<div role="menuitem" data-k="fresh">Not interested in this post</div>`;
      (menu.querySelector('[data-k="fresh"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("fresh");
        menu.remove();
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button>Undo</button><button>Show fewer from @x</button><button data-k="irrelevant">This post isn't relevant</button></div>`,
        );
        (cell.querySelector('[data-k="irrelevant"]') as HTMLElement).addEventListener("click", () =>
          clicked.push("irrelevant"),
        );
      });
      document.body.appendChild(menu);
    });

    await actions().notInterested(tweet());
    expect(clicked).toEqual(["fresh", "irrelevant"]);
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

  it("dismisses the menu and fails honestly when X never accepts the click", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Not interested in this post</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () =>
        clicked.push("not"),
      );
      document.body.appendChild(menu);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelector('[role="menu"]')?.remove();
    });

    await expect(actions().notInterested(tweet())).rejects.toThrow(/did not accept/i);
    expect(clicked).toEqual(["not", "not"]); // one retry, then honest failure
    expect(document.querySelector('[role="menu"]')).toBeNull(); // no stuck menu left behind
  });
});
