import { afterEach, describe, expect, it } from "vitest";

import { MUTE_ICON_PATH_PREFIX } from "@/content/selectors";
import { createCaretActions } from "@/core/x-client/caret-actions";

const clicked: string[] = [];

// Window "message" listeners outlive a test (afterEach only resets the DOM), so
// a leaked bridge listener would answer later tests' handshakes. Register every
// message listener through here and tear them all down between tests.
const messageCleanups: Array<() => void> = [];
function onBridgeMessage(handler: (event: MessageEvent) => void): void {
  window.addEventListener("message", handler);
  messageCleanups.push(() => window.removeEventListener("message", handler));
}

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
  for (const cleanup of messageCleanups.splice(0)) cleanup();
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

  it("resolves without a follow-up click when the panel never renders", async () => {
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
        (cell.querySelector("article") as Element).remove(); // article unmounts, no panel follows
      });
      document.body.appendChild(menu);
    });
    // effect === cellEl (article gone) but no feedback panel ever appears → the
    // grace-window wait times out and the follow-up click is skipped, no throw.
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not"]);
  });

  it("clicks the feedback panel that appears while the article is still mounted", async () => {
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
        // Panel lands synchronously and the tweet article stays mounted, so the
        // first probe finds the panel directly → effect !== cellEl (no grace wait).
        cell.insertAdjacentHTML(
          "beforeend",
          `<article><button>復原</button><button data-k="irrelevant">這是不相關的貼文</button></article>`,
        );
        (cell.querySelector('[data-k="irrelevant"]') as HTMLElement).addEventListener("click", () =>
          clicked.push("irrelevant"),
        );
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
    onBridgeMessage((event) => {
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

  it("reports the rows it saw when a required row is missing (mute)", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">跟隨 @someone</div>`;
      document.body.appendChild(menu);
    });
    // mute surfaces the missing-row diagnostic; notInterested swallows it (unavailable).
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 60 });
    await expect(a.mute(tweet())).rejects.toThrow(/跟隨 @someone/);
  });

  it("notInterested resolves 'unavailable' (and toggles the menu shut) where X offers no row", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    let menu: HTMLElement | null = null;
    caret.addEventListener("click", () => {
      if (menu?.isConnected) {
        menu.remove(); // X toggles its own menu shut on a second caret click
        menu = null;
        return;
      }
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">跟隨 @someone</div>`; // no "not interested" here
      document.body.appendChild(menu);
    });
    // No keydown→Escape listener: synthetic Escape can't dismiss X's menu (like live),
    // so the caret-toggle fallback in dismissMenu must close it.
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 60 });
    await expect(a.notInterested(tweet())).resolves.toBe("unavailable");
    expect(document.querySelector('[role="menu"]')).toBeNull();
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

  it("scrolls an off-screen caret into view before activating it", async () => {
    setup(document);
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    let scrolled = false;
    // Off-screen below the viewport so isolatedActivate re-centers it (line 88).
    caret.getBoundingClientRect = (() =>
      ({ top: 99999, bottom: 99999, left: 0, right: 0, width: 0, height: 0 }) as DOMRect) as never;
    caret.scrollIntoView = (() => {
      scrolled = true;
    }) as never;
    await actions().mute(tweet());
    expect(scrolled).toBe(true);
    expect(clicked).toEqual(["mute"]);
  });

  it("falls back to a plain click when the document has no window (no defaultView)", async () => {
    // A detached document has defaultView === null, so isolatedActivate cannot
    // synthesize pointer events and must use target.click() (lines 80-81).
    const detached = document.implementation.createHTMLDocument("x");
    detached.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = detached.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = detached.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      const row = menu.querySelector('[role="menuitem"]') as HTMLElement;
      row.addEventListener("click", () => {
        clicked.push("mute-detached");
        menu.remove();
      });
      detached.body.appendChild(menu);
    });
    const a = createCaretActions({ doc: detached, settle: async () => {}, timeoutMs: 1000 });
    await a.mute(detached.querySelector("article") as Element);
    expect(clicked).toEqual(["mute-detached"]);
  });

  it("throws when a confirmation sheet is required for block but never appears", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem" data-testid="block">Block @jack</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("block");
        menu.remove(); // menu closes, but no confirmation sheet is ever rendered
      });
      document.body.appendChild(menu);
    });

    await expect(actions().block(tweet())).rejects.toThrow(/confirmation sheet/i);
    expect(clicked).toEqual(["block"]);
  });

  it("re-finds the live row after X swaps in a fresh menu before the click", async () => {
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    let menu: HTMLElement;
    caret.addEventListener("click", () => {
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      document.body.appendChild(menu);
    });
    // settle(100) runs right after the row is found, before the isConnected
    // check — use it to detach the stale menu and mount a fresh one, forcing
    // findLiveRow to re-resolve the row across containers (lines 300-301, 323).
    const a = createCaretActions({
      doc: document,
      timeoutMs: 1000,
      confirmTimeoutMs: 50,
      settle: async (ms) => {
        if (ms === 100 && menu.isConnected) {
          menu.remove();
          const fresh = document.createElement("div");
          fresh.setAttribute("role", "menu");
          fresh.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
          (fresh.querySelector('[role="menuitem"]') as HTMLElement).addEventListener(
            "click",
            () => {
              clicked.push("fresh-mute");
              fresh.remove();
            },
          );
          document.body.appendChild(fresh);
        }
      },
    });
    await a.mute(tweet());
    expect(clicked).toEqual(["fresh-mute"]);
  });

  it("uses default deps (timeout/confirm/settle) when none are injected", async () => {
    // createCaretActions({ doc }) leaves timeoutMs, confirmTimeoutMs and settle
    // to their defaults — the default settle runs real timers via notInterested,
    // which never enters the confirm path so the test stays fast.
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
          `<div><button>Undo</button><button>Show fewer from @x</button><button data-k="irrelevant">This post isn't relevant</button></div>`,
        );
        (cell.querySelector('[data-k="irrelevant"]') as HTMLElement).addEventListener("click", () =>
          clicked.push("irrelevant"),
        );
      });
      document.body.appendChild(menu);
    });
    await createCaretActions().notInterested(tweet()); // no deps → doc defaults to global document
    expect(clicked).toEqual(["not", "irrelevant"]);
  });

  it("activates via plain MouseEvents when the window has no PointerEvent", async () => {
    // Some embeddings lack window.PointerEvent; isolatedActivate must skip the
    // pointer events and still drive the mouse sequence (line 104 else branch).
    const original = window.PointerEvent;
    (window as unknown as { PointerEvent?: unknown }).PointerEvent = undefined;
    try {
      setup(document);
      await actions().mute(tweet());
      expect(clicked).toEqual(["mute"]);
    } finally {
      (window as unknown as { PointerEvent?: unknown }).PointerEvent = original;
    }
  });

  it("keeps waiting when an unrelated mutation lands before the menu row", async () => {
    // The MutationObserver fires on a decoy node first (find() returns null, so
    // the `if (el)` guard's else is taken on line 176) before the real row lands.
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
      setTimeout(() => menu.appendChild(document.createElement("span")), 10); // decoy
      setTimeout(() => {
        const row = document.createElement("div");
        row.setAttribute("role", "menuitem");
        row.textContent = "Not interested in this post";
        row.addEventListener("click", () => {
          clicked.push("late");
          menu.remove();
        });
        menu.appendChild(row);
      }, 30);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["late"]);
  });

  it("clicks the show-fewer follow-up when no post-relevant button is present", async () => {
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
        // Only undo + show-fewer render (no "irrelevant"); show-fewer must win.
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button>Undo</button><button data-k="fewer">Show fewer from @x</button></div>`,
        );
        (cell.querySelector('[data-k="fewer"]') as HTMLElement).addEventListener("click", () =>
          clicked.push("fewer"),
        );
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not", "fewer"]);
  });

  it("uses the second button when only two non-undo feedback buttons render", async () => {
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
        // Unknown locale, exactly two buttons, none text-matched: index 1 wins.
        cell.insertAdjacentHTML(
          "beforeend",
          `<div><button data-k="a">Zurück</button><button data-k="b">Weniger</button></div>`,
        );
        for (const b of cell.querySelectorAll("[data-k]")) {
          b.addEventListener("click", () => clicked.push(b.getAttribute("data-k") as string));
        }
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not", "b"]);
  });

  it("throws when the caret click never opens a menu", async () => {
    // The caret has no click handler, so no menu container is ever added.
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 40 });
    await expect(a.mute(tweet())).rejects.toThrow(/caret menu did not open/i);
  });

  it("escapes a stale open menu even when the document has no window", async () => {
    // defaultView === null exercises the `new KeyboardEvent` fallback in
    // dismissOpenMenus; a pre-existing menu makes the dismiss loop actually run.
    const detached = document.implementation.createHTMLDocument("x");
    detached.body.innerHTML = `
      <div role="menu"><div role="menuitem">stale</div></div>
      <article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const stale = detached.querySelector('[role="menu"]') as HTMLElement;
    detached.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") stale.remove();
    });
    const caret = detached.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = detached.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("mute");
        menu.remove();
      });
      detached.body.appendChild(menu);
    });
    await createCaretActions({ doc: detached, settle: async () => {}, timeoutMs: 1000 }).mute(
      detached.querySelector("article") as Element,
    );
    expect(clicked).toEqual(["mute"]);
  });

  it("falls back to isolated activation when the bridge is ready but never replies", async () => {
    // Page advertises the bridge but no listener answers, so each activate waits
    // out the 250ms handshake timeout, sees its target attr untouched, and
    // returns false → isolatedActivate runs (the timer callback on line 66).
    document.documentElement.setAttribute("data-lasso-main-world-activate", "1");
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        clicked.push("mute");
        menu.remove();
      });
      document.body.appendChild(menu);
    });
    await actions().mute(tweet());
    expect(clicked).toEqual(["mute"]);
  });

  it("ignores duplicate bridge replies for the same request", async () => {
    // Two "activated" messages arrive for one request; the second must hit the
    // already-finished guard instead of resolving twice (line 35).
    document.documentElement.setAttribute("data-lasso-main-world-activate", "1");
    onBridgeMessage((event) => {
      const data = event.data as { channel?: string; requestId?: string; type?: string } | null;
      if (
        data?.channel !== "__lasso_x_main_world_activate__" ||
        data.type !== "activate" ||
        !data.requestId
      ) {
        return;
      }
      const reply = {
        channel: "__lasso_x_main_world_activate__",
        ok: true,
        requestId: data.requestId,
        type: "activated",
      };
      const target = [...document.querySelectorAll("[data-lasso-activate-target]")][0];
      if (target) {
        (target as HTMLElement).click();
        if (target.getAttribute("role") === "menuitem") clicked.push("bridge");
        target.closest('[role="menu"]')?.remove();
      }
      window.postMessage(reply, "*");
      window.postMessage(reply, "*"); // duplicate — exercises the done-guard
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

  it("ignores a late handshake timeout that races a reply already handled", async () => {
    // Real browsers can fire a setTimeout whose callback was already queued even
    // after clearTimeout (the timer/message duality the bridge documents). With
    // clearTimeout neutralised, the ack reply finishes first and the surviving
    // 250ms timer then re-enters finish — the `done` guard must swallow it
    // (line 35) so the promise never resolves twice.
    const realClearTimeout = window.clearTimeout.bind(window);
    const realSetTimeout = window.setTimeout.bind(window);
    (window as unknown as { clearTimeout: (id?: number) => void }).clearTimeout = () => {};
    try {
      document.documentElement.setAttribute("data-lasso-main-world-activate", "1");
      onBridgeMessage((event) => {
        const data = event.data as { channel?: string; id?: string; type?: string } | null;
        if (data?.channel !== "__lasso_x_main_world_activate__" || data.type !== "activate") return;
        const target = [...document.querySelectorAll("[data-lasso-activate-target]")].find(
          (el) => el.getAttribute("data-lasso-activate-target") === data.id,
        );
        if (!target) return;
        (target as HTMLElement).click();
        if (target.getAttribute("role") === "menuitem") {
          clicked.push("bridge");
          target.closest('[role="menu"]')?.remove();
        }
        window.postMessage(
          {
            channel: "__lasso_x_main_world_activate__",
            ok: true,
            requestId: (event.data as { requestId?: string }).requestId,
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
      // Let the surviving 250ms timers fire so the done-guard runs.
      await new Promise((r) => realSetTimeout(r, 400));
    } finally {
      (window as unknown as { clearTimeout: typeof realClearTimeout }).clearTimeout =
        realClearTimeout;
    }
  });

  it("treats a stripped target attribute as a handled click when the ack times out", async () => {
    // The bridge clicks the target and strips its activate-target attr but never
    // posts the ack. The 250ms timeout then sees the attr gone and reports the
    // click as handled (line 66 timer + line 39 else: attr no longer === id).
    document.documentElement.setAttribute("data-lasso-main-world-activate", "1");
    onBridgeMessage((event) => {
      const data = event.data as { channel?: string; id?: string; type?: string } | null;
      if (data?.channel !== "__lasso_x_main_world_activate__" || data.type !== "activate") return;
      const target = [...document.querySelectorAll("[data-lasso-activate-target]")].find(
        (el) => el.getAttribute("data-lasso-activate-target") === data.id,
      );
      if (!target) return;
      target.removeAttribute("data-lasso-activate-target"); // strip BEFORE click, no ack
      (target as HTMLElement).click();
      if (target.getAttribute("role") === "menuitem") {
        clicked.push("bridge");
        target.closest('[role="menu"]')?.remove();
      }
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

  it("keeps the stale row when no live row can be re-resolved after a swap", async () => {
    // During settle(100) the matched Mute row is detached but the menu stays open
    // with a non-matching row, so findLiveRow finds nothing (line 302's ?? null),
    // run() falls back to the stale detached row (line 323's ?? row), the menu
    // never closes, and it fails honestly after the retry.
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    let muteRow: HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem" data-k="mute"><svg><path d="${MUTE_ICON_PATH_PREFIX}xyz"></path></svg>Mute</div>`;
      muteRow = menu.querySelector('[role="menuitem"]') as HTMLElement;
      document.body.appendChild(menu);
    });
    const a = createCaretActions({
      doc: document,
      timeoutMs: 1000,
      confirmTimeoutMs: 50,
      settle: async (ms) => {
        if (ms === 100 && muteRow.isConnected) {
          // Detach the Mute row, leave a non-matching row so the menu stays open.
          const menu = muteRow.closest('[role="menu"]') as HTMLElement;
          muteRow.remove();
          menu.innerHTML = `<div role="menuitem">Some other action</div>`;
        }
      },
    });
    await expect(a.mute(tweet())).rejects.toThrow(/did not accept/i);
  });

  it("succeeds without a follow-up click when the article unmounts but no panel appears", async () => {
    // X accepts not-interested and removes the article, but never renders the
    // feedback buttons. The unmount alone is a real side effect, so the action
    // succeeds and the `if (feedback)` branch is skipped (line 361 else).
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
        (cell.querySelector("article") as Element).remove(); // unmount, no panel
      });
      document.body.appendChild(menu);
    });
    await actions().notInterested(tweet());
    expect(clicked).toEqual(["not"]);
  });

  it("lists rows that have no text in the no-match error (mute)", async () => {
    // A row whose textContent is empty exercises the label fallback inside the
    // diagnostic message builder; mute surfaces it as a thrown error.
    document.body.innerHTML = `<article data-testid="tweet"><button data-testid="caret"></button></article>`;
    const caret = document.querySelector('[data-testid="caret"]') as HTMLElement;
    caret.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      const row = document.createElement("div");
      row.setAttribute("role", "menuitem"); // no text node at all
      menu.appendChild(row);
      document.body.appendChild(menu);
    });
    const a = createCaretActions({ doc: document, settle: async () => {}, timeoutMs: 60 });
    await expect(a.mute(tweet())).rejects.toThrow(/target menu item not found/i);
  });
});
