import { afterEach, describe, expect, it } from "vitest";

import { DomXListApi } from "@/packages/x-client/dom-api";
import {
  createDomPageDriver,
  type DomPageDriverOptions,
} from "@/packages/x-client/dom-page-driver";
import { XApiError, type XList } from "@/packages/x-client/types";

const list = (name: string, id = name): XList => ({ id, name });
const RESEARCH = list("Research", "1");
const FRIENDS = list("Friends", "2");
const SYNTHETIC_EVENT_FLAG = "__testSyntheticEscape";

async function expectUnknownFailure(action: Promise<unknown>, message: RegExp): Promise<void> {
  const failure = await action.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(XApiError);
  expect(failure).toMatchObject({ kind: "unknown", message: expect.stringMatching(message) });
}

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
      (
        dialog.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement
      ).addEventListener("click", () => dialog.remove());
      doc.body.appendChild(dialog);
    });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
});

const findAuthorCaret =
  (doc: Document) =>
  (screenName: string): Element | null =>
    screenName.toLowerCase() === "jack" ? doc.querySelector('[data-testid="caret"]') : null;
const dispatchSyntheticEscape = (target: Document | Element): void => {
  const event = new KeyboardEvent("keydown", { bubbles: true, key: "Escape" });
  (event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG] = true;
  target.dispatchEvent(event);
};
const driver = (overrides: Partial<DomPageDriverOptions> = {}) => {
  const doc = overrides.doc ?? document;
  return createDomPageDriver({
    dispatchSyntheticEscape,
    doc,
    findAuthorCaret: findAuthorCaret(doc),
    settle: async () => {},
    timeoutMs: 1000,
    ...overrides,
  });
};

describe("createDomPageDriver (synthetic x.com)", () => {
  it("throws before a dialog opens or after its dialog disconnects", async () => {
    setupSyntheticX(document);
    const d = driver();
    await expectUnknownFailure(d.isChecked(RESEARCH), /not found/);
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[role="dialog"]')?.remove();
    await expectUnknownFailure(d.isChecked(RESEARCH), /not found/);
  });

  it("rejects a non-English X interface before clicking the caret", async () => {
    setupSyntheticX(document);
    document.documentElement.lang = "de-AT";
    let caretClicks = 0;
    document.querySelector('[data-testid="caret"]')?.addEventListener("click", () => caretClicks++);

    await expectUnknownFailure(
      driver().openListsDialog({ screenName: "jack" }),
      /requires X in English.*REST or GraphQL/i,
    );

    expect(caretClicks).toBe(0);
  });

  it("does not escape unrelated UI after English or no-caret failures", async () => {
    let escapes = 0;
    document.addEventListener("keydown", (event) => {
      if ((event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) escapes++;
    });

    setupSyntheticX(document);
    document.documentElement.lang = "de";
    await expectUnknownFailure(
      new DomXListApi(driver()).addMember(RESEARCH, { screenName: "jack" }),
      /requires X in English/,
    );

    document.body.innerHTML = "";
    document.documentElement.lang = "en";
    await expectUnknownFailure(
      new DomXListApi(driver()).addMember(RESEARCH, { screenName: "ghost" }),
      /no visible tweet/,
    );

    expect(escapes).toBe(0);
  });

  it("opens the Lists dialog from a tweet's caret", async () => {
    setupSyntheticX(document);
    document.documentElement.lang = "en-AU";
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

  it("reads and toggles row checked state, then returns an explicit receipt", async () => {
    setupSyntheticX(document);
    const d = driver();
    let escapes = 0;
    document.addEventListener("keydown", (event) => {
      if ((event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) escapes++;
    });
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
    expect(await d.isChecked(FRIENDS)).toBe(true);
    await d.toggleList(RESEARCH);
    expect(await d.isChecked(RESEARCH)).toBe(true);
    await expect(d.commit()).resolves.toBe("explicit");
    await d.close();
    expect(escapes).toBe(0);
  });

  it("reads native checkbox state without toggling an existing membership", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.insertAdjacentHTML(
      "afterbegin",
      `<div role="menuitem"><span>Native</span><input type="checkbox" checked></div>`,
    );
    const native = list("Native");

    expect(await d.isChecked(native)).toBe(true);
    (dialog.querySelector('input[type="checkbox"]') as HTMLInputElement).checked = false;
    expect(await d.isChecked(native)).toBe(false);
  });

  it("fails before toggling a row without a readable checked state", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.insertAdjacentHTML("beforeend", `<div role="menuitem">No checkbox</div>`);
    const row = [...dialog.querySelectorAll('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "No checkbox",
    ) as HTMLElement;
    let clicks = 0;
    row.addEventListener("click", () => clicks++);

    await expectUnknownFailure(d.isChecked(list("No checkbox")), /no readable checked state/);
    expect(clicks).toBe(0);
  });

  it("throws for missing rows", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    await expectUnknownFailure(d.isChecked(list("Missing")), /not found/);
    await expectUnknownFailure(d.toggleList(list("Missing")), /not found/);
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

  it("harvests no id from a row link that is not an /i/lists URL", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem"><a href="/jack">Research</a><div role="checkbox" aria-checked="true"></div></div>`;

    // /jack is not an /i/lists/<id> path, so the regex misses and no id is added.
    // With no id identity, the row can only be resolved by its visible name; had
    // a spurious id been harvested, rowFor would reject the name match as "not found".
    expect(await d.isChecked(RESEARCH)).toBe(true);
  });

  it("throws instead of choosing the first duplicate name", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem"><span>Research</span></div>
      <div role="menuitem"><span>Research</span></div>`;

    await expectUnknownFailure(d.isChecked(RESEARCH), /ambiguous/);
    await expectUnknownFailure(d.toggleList(RESEARCH), /ambiguous/);
  });

  it("throws when two rows share the target List id", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `
      <div role="menuitem" data-list-id="1"><span>Research</span></div>
      <div role="menuitem" data-list-id="1"><span>Research copy</span></div>`;

    await expectUnknownFailure(d.isChecked(RESEARCH), /ambiguous/);
    await expectUnknownFailure(d.toggleList(RESEARCH), /ambiguous/);
  });

  it("does not use a name when the sole row names another List id", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.innerHTML = `<div role="menuitem" data-list-id="2"><span>Research</span></div>`;

    await expectUnknownFailure(d.isChecked(RESEARCH), /not found/);
  });

  it("returns an immediate receipt without Save and marks its closing Escape as driver-internal", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
    let closingEvent: KeyboardEvent | null = null;
    document.body.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") closingEvent = e as KeyboardEvent;
    });
    await expect(d.commit()).resolves.toBe("immediate");
    await d.close();
    expect(closingEvent).not.toBeNull();
    expect((closingEvent as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]).toBe(true);
  });

  it("commits through an exact Done button fallback", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const done = document.createElement("button");
    done.textContent = "Done";
    let clicks = 0;
    done.addEventListener("click", () => {
      clicks++;
      dialog.remove();
    });
    dialog.appendChild(done);

    await expect(d.commit()).resolves.toBe("explicit");

    expect(clicks).toBe(1);
  });

  it("never clicks an unowned confirmation sheet", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();

    const stale = document.createElement("button");
    stale.setAttribute("data-testid", "confirmationSheetConfirm");
    let staleClicks = 0;
    stale.addEventListener("click", () => staleClicks++);
    document.body.appendChild(stale);

    const done = document.createElement("button");
    done.textContent = "Done";
    let unrelatedClicks = 0;
    done.addEventListener("click", () => {
      const confirmation = document.createElement("button");
      confirmation.setAttribute("data-testid", "confirmationSheetConfirm");
      confirmation.addEventListener("click", () => {
        unrelatedClicks++;
      });
      document.body.appendChild(confirmation);
    });
    dialog.appendChild(done);

    await expectUnknownFailure(d.commit(), /unowned confirmation/);
    expect(unrelatedClicks).toBe(0);
    expect(staleClicks).toBe(0);
  });

  it("rejects a confirmation that replaces the Lists dialog in the same mutation", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();

    const done = document.createElement("button");
    done.textContent = "Done";
    let confirmationClicks = 0;
    done.addEventListener("click", () => {
      dialog.remove();
      const confirmation = document.createElement("button");
      confirmation.setAttribute("data-testid", "confirmationSheetConfirm");
      confirmation.addEventListener("click", () => confirmationClicks++);
      document.body.appendChild(confirmation);
    });
    dialog.appendChild(done);

    await expectUnknownFailure(d.commit(), /unowned confirmation/);
    expect(confirmationClicks).toBe(0);
  });

  it("fails instead of treating an unknown Apply control as autosave", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    document.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
    const apply = document.createElement("button");
    apply.textContent = "Apply";
    document.querySelector('[role="dialog"]')?.appendChild(apply);

    await expectUnknownFailure(d.commit(), /unrecognized commit control/);
  });

  it("fails closed for empty and aria-label-only controls", async () => {
    for (const controlMarkup of ["<button></button>", '<button aria-label="Close"></button>']) {
      setupSyntheticX(document);
      const d = driver();
      await d.openListsDialog({ screenName: "jack" });
      document.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
      document.querySelector('[role="dialog"]')?.insertAdjacentHTML("beforeend", controlMarkup);

      await expectUnknownFailure(d.commit(), /unrecognized commit control/);
      document.body.innerHTML = "";
    }
  });

  it("fails as unknown when an explicit commit leaves the original dialog open", async () => {
    setupSyntheticX(document);
    const d = driver({ timeoutMs: 5 });
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const save = dialog.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement;
    save.replaceWith(save.cloneNode(true));

    const failure = await d.commit().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(XApiError);
    expect(failure).toMatchObject({
      kind: "unknown",
      message: "Timed out waiting for X to close the Lists dialog after explicit commit",
    });
    expect(dialog.isConnected).toBe(true);
  });

  it("rejects a commit after its owned dialog closes during settle", async () => {
    setupSyntheticX(document);
    let settles = 0;
    const d = driver({
      settle: async () => {
        settles++;
        if (settles === 3) document.querySelector('[role="dialog"]')?.remove();
      },
    });
    await d.openListsDialog({ screenName: "jack" });
    await expectUnknownFailure(d.commit(), /closed before its change/i);
  });

  it("ignores controls nested in list rows when detecting unknown commit controls", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.querySelector('[data-testid="confirmationSheetConfirm"]')?.remove();
    dialog.insertAdjacentHTML("beforeend", `<div role="menuitem"><button>Apply</button></div>`);
    await expect(d.commit()).resolves.toBe("immediate");
  });

  it("throws a clear error when the author has no visible tweet", async () => {
    document.body.innerHTML = "";
    await expectUnknownFailure(
      driver().openListsDialog({ screenName: "ghost" }),
      /no visible tweet/i,
    );
  });

  it("uses the injected author-caret locator", async () => {
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
    const d = driver({
      findAuthorCaret: (screenName) =>
        screenName === "jack"
          ? (document.querySelectorAll('[data-testid="caret"]')[1] ?? null)
          : null,
    });
    await d.openListsDialog({ screenName: "jack" });
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("throws when the caret menu never opens", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    const d = driver({ timeoutMs: 5 });
    await expectUnknownFailure(d.openListsDialog({ screenName: "jack" }), /timed out/);
  });

  it("fails if its newly opened menu closes during the settle window", async () => {
    setupSyntheticX(document);
    const d = driver({
      settle: async (ms) => {
        if (ms === 120) document.querySelector('[role="menu"]')?.remove();
      },
    });

    await expectUnknownFailure(d.openListsDialog({ screenName: "jack" }), /menu changed before/i);
  });

  it("fails if the Lists item is replaced during the settle window", async () => {
    setupSyntheticX(document);
    const d = driver({
      settle: async (ms) => {
        if (ms === 120) document.querySelector('[role="menuitem"]:nth-child(2)')?.remove();
      },
    });

    await expectUnknownFailure(
      d.openListsDialog({ screenName: "jack" }),
      /Lists.*changed before use/i,
    );
  });

  it("waits through unrelated portal mutations before the fresh menu appears", async () => {
    document.body.innerHTML = `<button data-testid="caret"></button>`;
    document.querySelector("button")?.addEventListener("click", () => {
      queueMicrotask(() => document.body.appendChild(document.createElement("span")));
      setTimeout(() => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML = `<div role="menuitem">Follow @jack</div>`;
        document.body.appendChild(menu);
      }, 0);
    });
    await expectUnknownFailure(
      driver({ timeoutMs: 1000 }).openListsDialog({ screenName: "jack" }),
      /menu item/,
    );
  });

  it("uses document, timeout, and settle defaults when no overrides are supplied", async () => {
    setupSyntheticX(document);
    const d = createDomPageDriver({
      findAuthorCaret: findAuthorCaret(document),
      dispatchSyntheticEscape,
    });
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
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
    const d = driver({ timeoutMs: 50 });
    await expectUnknownFailure(d.openListsDialog({ screenName: "jack" }), /menu item/);
  });

  it("closes a partially opened owned menu once", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    let escapes = 0;
    document.querySelector("button")?.addEventListener("click", () => {
      const menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Follow @jack</div>`;
      menu.addEventListener("keydown", (event) => {
        if ((event as unknown as Record<string, unknown>)[SYNTHETIC_EVENT_FLAG]) escapes++;
      });
      document.body.appendChild(menu);
    });

    await expectUnknownFailure(
      new DomXListApi(driver()).addMember(RESEARCH, { screenName: "jack" }),
      /menu item/,
    );
    expect(escapes).toBe(1);
  });

  it("never clicks a Lists item that was replaced during settle", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    let listClicks = 0;
    let menu: HTMLElement | undefined;
    document.querySelector("button")?.addEventListener("click", () => {
      menu = document.createElement("div");
      menu.setAttribute("role", "menu");
      menu.innerHTML = `<div role="menuitem">Add/remove @jack from Lists</div>`;
      (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
        listClicks++;
      });
      document.body.appendChild(menu);
    });
    const d = driver({
      settle: async (ms) => {
        if (ms === 120) menu?.remove();
      },
      timeoutMs: 100,
    });

    await expectUnknownFailure(d.openListsDialog({ screenName: "jack" }), /menu changed/);
    expect(listClicks).toBe(0);
  });

  it("waits for asynchronously inserted menus and dialogs", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>`;
    document.querySelector("button")?.addEventListener("click", () => {
      queueMicrotask(() => document.body.appendChild(document.createElement("span")));
      queueMicrotask(() => {
        const menu = document.createElement("div");
        menu.setAttribute("role", "menu");
        menu.innerHTML = `<div role="menuitem">Add/remove @jack from Lists</div>`;
        (menu.querySelector('[role="menuitem"]') as HTMLElement).addEventListener("click", () => {
          queueMicrotask(() => document.body.appendChild(document.createElement("span")));
          queueMicrotask(() => {
            const dialog = document.createElement("div");
            dialog.setAttribute("role", "dialog");
            dialog.innerHTML =
              `<div role="menuitem">Research` +
              `<div role="checkbox" aria-checked="false"></div></div>`;
            document.body.appendChild(dialog);
          });
        });
        document.body.appendChild(menu);
      });
    });
    const d = driver({ timeoutMs: 1000 });
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(RESEARCH)).toBe(false);
  });

  it("accepts menu and dialog portal nodes whose contents are reused", async () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/jack/status/1"><time>1h</time></a></div>
        <button data-testid="caret"></button>
      </article>
      <div role="menu"><div role="menuitem">Old menu</div></div>
      <div role="dialog"><div role="menuitem">Old dialog</div></div>`;
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    document.querySelector('[data-testid="caret"]')?.addEventListener("click", () => {
      menu.innerHTML = `<div role="menuitem">Add/remove @jack from Lists</div>`;
      menu.querySelector('[role="menuitem"]')?.addEventListener("click", () => {
        dialog.innerHTML =
          `<div role="menuitem"><span>Research</span>` +
          `<div role="checkbox" aria-checked="false"></div></div>`;
      });
    });

    const d = driver();
    await d.openListsDialog({ screenName: "jack" });

    expect(await d.isChecked(RESEARCH)).toBe(false);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it("works with injected content adapters and default timing", async () => {
    setupSyntheticX(document);
    const d = driver();
    await d.openListsDialog({ screenName: "jack" });
    expect(await d.isChecked(FRIENDS)).toBe(true);
  });

  it("works with a detached document supplied by its content adapter", async () => {
    const doc = document.implementation.createHTMLDocument("detached");
    setupSyntheticX(doc);
    const staleMenu = doc.createElement("div");
    staleMenu.setAttribute("role", "menu");
    doc.body.appendChild(staleMenu);
    const d = driver({ doc, timeoutMs: 100 });

    await d.openListsDialog({ screenName: "jack" });

    expect(await d.isChecked(RESEARCH)).toBe(false);
  });
});
