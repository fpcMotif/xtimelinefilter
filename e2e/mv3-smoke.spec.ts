import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test, type BrowserContext, type CDPSession } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = resolve(ROOT, "dist");

const X_FIXTURE = `<!doctype html>
<div data-testid="primaryColumn">
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name">
        <div><a href="/jack">Jack</a></div>
        <div><a href="/jack">@jack</a><a href="/jack/status/1"><time>1h</time></a></div>
      </div>
      <div data-testid="tweetText" lang="en">Local X fixture</div>
    </article>
  </div>
</div>`;

type ExecutionContext = {
  id: number;
  auxData?: { frameId?: string; isDefault?: boolean; type?: string };
};

const wait = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

async function isolatedExtensionContext(
  cdp: CDPSession,
  extensionId: string,
  contexts: Map<number, ExecutionContext>,
): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const matching = (
      await Promise.all(
        [...contexts.values()]
          .filter((candidate) => candidate.auxData?.type === "isolated")
          .map(async (candidate) => {
            try {
              const result = await cdp.send("Runtime.evaluate", {
                contextId: candidate.id,
                expression: "chrome.runtime?.id ?? null",
                returnByValue: true,
              });
              return result.result.value === extensionId ? candidate.id : null;
            } catch {
              // Navigation can destroy a world between CDP discovery and probe.
              return null;
            }
          }),
      )
    ).filter((contextId): contextId is number => contextId !== null);
    if (matching.length === 1) return matching[0]!;
    await wait(50);
  }

  throw new Error("No unique X isolated execution context matched the extension runtime ID");
}

async function contentStorageReadability(
  cdp: CDPSession,
  contextId: number,
): Promise<{ local: "blocked" | "readable"; sync: "blocked" | "readable" }> {
  const result = await cdp.send("Runtime.evaluate", {
    contextId,
    awaitPromise: true,
    returnByValue: true,
    // Deliberately discard get()'s result. This probe returns access status only.
    expression: `Promise.all([
      [chrome.storage.local, "lasso:settings"],
      [chrome.storage.sync, "lasso:filter"],
    ].map(async ([area, key]) => {
      try {
        await area.get(key);
        return "readable";
      } catch {
        return "blocked";
      }
    })).then(([local, sync]) => ({ local, sync }))`,
  });

  return result.result.value as { local: "blocked" | "readable"; sync: "blocked" | "readable" };
}

test("MV3 build loads its worker and injects content on local X", async () => {
  const profile = await mkdtemp(join(tmpdir(), "lasso-mv3-"));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    expect(serviceWorker.url()).toMatch(/^chrome-extension:\/\//);

    // Exercise the public protocol from a real extension page. This proves the
    // worker, runtime transport, validation, and Chrome storage all agree.
    const extensionOrigin = `chrome-extension://${new URL(serviceWorker.url()).host}`;
    const options = await context.newPage();
    await options.goto(`${extensionOrigin}/src/options/index.html`);
    const protocol = await options.evaluate(async () => {
      const settings = await chrome.runtime.sendMessage({
        type: "lasso:settings",
        operation: "read",
      });

      // Folders, end to end against REAL IndexedDB in a real worker — the
      // collections suite otherwise runs against an injected in-memory store,
      // which is a fixture and cannot prove Chrome behaves as assumed.
      // Declared INSIDE the page evaluate on purpose: the outer scope is Node,
      // not the page, so this cannot be hoisted.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      const send = (message: Record<string, unknown>) =>
        chrome.runtime.sendMessage({ type: "lasso:collections", ...message });
      const token = async () => (await send({ operation: "begin" })).token;
      const created = await send({
        operation: "create-folder",
        name: "Smoke",
        token: await token(),
      });
      const saved = await send({
        operation: "save-post",
        folderId: created.folder.folderId,
        token: await token(),
        capture: { statusId: "1", permalink: "https://x.com/jack/status/1", media: [] },
      });
      const again = await send({
        operation: "save-post",
        folderId: created.folder.folderId,
        token: await token(),
        capture: { statusId: "1", permalink: "https://x.com/jack/status/1", media: [] },
      });
      const counts = await send({ operation: "counts" });
      const databasesBefore = (await indexedDB.databases()).map((entry) => entry.name);

      const cleared = await chrome.runtime.sendMessage({ type: "lasso:clear-data" });
      const afterClear = await chrome.runtime.sendMessage({
        type: "lasso:settings",
        operation: "read",
      });
      // Listed BEFORE any further collections call: a read after Clear reopens
      // the store, which recreates an empty database and would mask the delete.
      const databasesAfter = (await indexedDB.databases()).map((entry) => entry.name);
      const countsAfterClear = await send({ operation: "counts" });

      return {
        settings,
        cleared,
        afterClear,
        collections: { created, saved, again, counts, databasesBefore },
        afterClearCollections: { countsAfterClear, databasesAfter },
      };
    });
    expect(protocol.settings).toMatchObject({
      ok: true,
      settings: { backend: expect.any(String) },
    });
    // The worker really opened IndexedDB, minted a Folder and filed a post.
    expect(protocol.collections.created).toMatchObject({
      ok: true,
      folder: { name: "Smoke", folderId: expect.stringMatching(/^fld_[0-9a-v]{20}$/) },
    });
    expect(protocol.collections.saved).toEqual({
      ok: true,
      outcome: { status: "saved", statusId: "1" },
      createdSavedPost: true,
    });
    // Saved once: filing the same post into the same Folder writes nothing.
    expect(protocol.collections.again).toEqual({
      ok: true,
      outcome: { status: "already-there", statusId: "1" },
      createdSavedPost: false,
    });
    expect(protocol.collections.counts).toEqual({
      ok: true,
      counts: { folders: 1, savedPosts: 1 },
    });
    expect(protocol.collections.databasesBefore).toContain("lasso:folders");

    expect(protocol.cleared).toEqual({ localCleared: true, syncCleared: true });
    // Privacy Clear destroyed the database itself, not just the storage keys.
    expect(protocol.afterClearCollections.databasesAfter).not.toContain("lasso:folders");
    expect(protocol.afterClearCollections.countsAfterClear).toEqual({
      ok: true,
      counts: { folders: 0, savedPosts: 0 },
    });
    expect(protocol.afterClear).toMatchObject({
      ok: true,
      settings: { backend: expect.any(String) },
    });
    await options.close();

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const executionContexts = new Map<number, ExecutionContext>();
    cdp.on("Runtime.executionContextCreated", ({ context: createdContext }) => {
      executionContexts.set(createdContext.id, createdContext as ExecutionContext);
    });
    cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
      executionContexts.delete(executionContextId);
    });
    await cdp.send("Runtime.enable");
    // This fulfils the canonical content-script match locally; no X account or
    // network response is involved.
    await page.route("https://x.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: X_FIXTURE }),
    );
    await page.goto("https://x.com/home");

    await expect(page.locator("#lasso-root")).toBeAttached();
    await expect(page.locator("[data-lasso-overlay]")).toHaveCount(1);
    await page.getByText("Skip", { exact: true }).click();
    await page.locator("article").hover();
    await expect(page.getByRole("button", { name: "Select @jack" })).toBeVisible();

    // CDP sees every page world. Select exactly the isolated world whose runtime
    // ID is this loaded extension, then ask only whether direct reads succeed.
    // The settings request above waits for both TRUSTED_CONTEXTS locks.
    const contentContextId = await isolatedExtensionContext(
      cdp,
      new URL(serviceWorker.url()).host,
      executionContexts,
    );
    await expect
      .poll(() => contentStorageReadability(cdp, contentContextId))
      .toEqual({
        local: "blocked",
        sync: "blocked",
      });

    // Set the persisted Filter after content is live. The background must relay
    // this transition to the existing content script; no reload may be needed.
    const filterPage = await context.newPage();
    await filterPage.goto(`${extensionOrigin}/src/options/index.html`);
    const filterSet = await filterPage.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "lasso:filter",
        operation: "command",
        defaultLanguages: [],
        command: { type: "set-mode", id: "kind:text", mode: "hide" },
      }),
    );
    expect(filterSet).toMatchObject({ ok: true, state: { criteria: { "kind:text": "hide" } } });
    await filterPage.close();

    const cell = page.locator("[data-testid='cellInnerDiv']");
    const article = page.locator("article[data-testid='tweet']");
    const overlay = page.locator("[data-lasso-overlay]");
    await expect(cell).toHaveAttribute("data-lasso-filtered", "");
    await expect(page.locator("[data-lasso-filter-stub]")).toHaveText("· hidden — show");
    await expect(article).toBeHidden();
    // The overlay remains mounted for a later restore, but collapse CSS makes it
    // unreachable even after select mode turns it on.
    await expect(overlay).toBeHidden();
    await page.keyboard.press("c");
    await expect(page.locator("[aria-label='Lasso select mode']")).toBeVisible();
    await expect(overlay).toBeHidden();

    // A new content lifetime must still hydrate the persisted filter and apply
    // the same collapse before its UI becomes interactive.
    await page.reload();
    await expect(cell).toHaveAttribute("data-lasso-filtered", "");
    await expect(page.locator("[data-lasso-filter-stub]")).toHaveText("· hidden — show");
    await expect(article).toBeHidden();
    await expect(overlay).toBeHidden();

    // The stub restores the same cell without a navigation or a new content
    // lifetime. Its overlay follows the restored article.
    await page.locator("[data-lasso-filter-stub]").click();
    await expect(cell).not.toHaveAttribute("data-lasso-filtered", "");
    await expect(article).toBeVisible();
    await article.hover();
    await expect(page.getByRole("button", { name: "Select @jack" })).toBeVisible();

    // Leave the fresh extension profile in the same cleared state as the
    // earlier worker/storage smoke, rather than relying only on temp-dir cleanup.
    const clearPage = await context.newPage();
    await clearPage.goto(`${extensionOrigin}/src/options/index.html`);
    const filterCleared = await clearPage.evaluate(() =>
      chrome.runtime.sendMessage({ type: "lasso:clear-data" }),
    );
    expect(filterCleared).toEqual({ localCleared: true, syncCleared: true });
    await clearPage.close();
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
