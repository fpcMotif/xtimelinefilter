import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test, type BrowserContext } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = resolve(ROOT, "dist");
const THREADS_FIXTURE = `<!doctype html><html><body>
  <main>
    <div class="post" id="one"><a href="/@alice/post/ONE-1"><time datetime="2026-08-01T10:00:00Z">now</time></a><p>First Threads post</p></div>
    <div class="post" id="two"><a href="/@bob/post/TWO-2"><time datetime="2026-08-01T10:00:00Z">now</time></a><p>Second Threads post</p></div>
  </main>
</body></html>`;

test("MV3 injects Threads content and persists a keyboard save", async () => {
  const profile = await mkdtemp(join(tmpdir(), "lasso-social-mv3-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    const extensionOrigin = `chrome-extension://${new URL(serviceWorker.url()).host}`;

    const options = await context.newPage();
    await options.goto(`${extensionOrigin}/src/options/index.html`);
    const folder = await options.evaluate(async () => {
      const begin = await chrome.runtime.sendMessage({
        type: "lasso:collections",
        operation: "begin",
      });
      return chrome.runtime.sendMessage({
        type: "lasso:collections",
        operation: "create-folder",
        name: "Reading",
        token: begin.token,
      });
    });
    expect(folder).toMatchObject({ ok: true, folder: { name: "Reading" } });
    const folderId = folder.folder.folderId;
    await options.close();

    const page = await context.newPage();
    await page.route("https://www.threads.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: THREADS_FIXTURE }),
    );
    await page.goto("https://www.threads.com/home");
    await expect(page.locator("#lasso-root")).toBeAttached();

    await page.keyboard.press("j");
    await page.keyboard.press("j");
    await expect(page.locator("#two[data-lasso-cursor='true']")).toHaveCount(1);
    await page.keyboard.press("Alt+Shift+b");
    await expect(page.getByText("Saved to Reading")).toBeVisible();

    const saved = await optionsForRead(context, extensionOrigin, folderId);
    expect(saved).toMatchObject({ ok: true, page: { posts: [{ statusId: "threads:TWO-2" }] } });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});

async function optionsForRead(
  context: BrowserContext,
  extensionOrigin: string,
  folderId: string,
): Promise<unknown> {
  const options = await context.newPage();
  try {
    await options.goto(`${extensionOrigin}/src/options/index.html`);
    return await options.evaluate(
      async (id) =>
        chrome.runtime.sendMessage({
          type: "lasso:collections",
          operation: "read-folder-page",
          folderId: id,
          limit: 10,
          cursor: null,
        }),
      folderId,
    );
  } finally {
    await options.close();
  }
}
