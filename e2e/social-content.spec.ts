import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/assets");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    try {
      const path = resolve(DIST, `.${new URL(req.url ?? "/", "http://local").pathname}`);
      res.setHeader("content-type", MIME[extname(path)] ?? "application/octet-stream");
      res.end(readFileSync(path));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  const started = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", started.resolve);
  await started.promise;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  const closed = Promise.withResolvers<void>();
  server.close((error) => {
    if (error) closed.reject(error);
    else closed.resolve();
  });
  await closed.promise;
});

function contentBundle(): string {
  const file = readdirSync(DIST).find(
    (name) => /^non-x-main\.tsx-.*\.js$/.test(name) && !name.includes("-loader-"),
  );
  if (!file) throw new Error("Build the extension first: `bun run build`");
  return file;
}

const CHROME_STUB = `(() => {
  const folderId = "fld_0123456789abcdefghij";
  const folders = [{ folderId, name: "Reading", sortIndex: 0, createdAt: 1, updatedAt: 1, deletedAt: null }];
  const saved = new Set();
  const state = { lastRequest: null, lastDefault: null, saved: [] };
  window.__collections = state;
  window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async (request) => {
        state.lastRequest = request;
        switch (request.operation) {
          case "begin":
            return { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } };
          case "list-folders":
            return { ok: true, folders };
          case "folders-holding":
            return { ok: true, folderIds: saved.has(request.statusId) ? [folderId] : [] };
          case "save-to-default-folder": {
            const statusId = request.capture.statusId;
            const already = saved.has(statusId);
            saved.add(statusId);
            state.lastDefault = { statusId, already };
            state.saved.push(request.capture);
            return { ok: true, defaultSave: { status: "saved", saved: already ? "already-there" : "created", createdSavedPost: !already, folderId, folderName: "Reading", statusId } };
          }
          case "save-post": {
            const statusId = request.capture.statusId;
            const already = saved.has(statusId);
            saved.add(statusId);
            state.saved.push(request.capture);
            return { ok: true, outcome: { status: "saved", statusId }, createdSavedPost: !already };
          }
          case "remove-from-folder":
          case "delete-saved-post":
            saved.delete(request.statusId);
            return { ok: true };
          default:
            return { ok: true };
        }
      },
    },
  };
})();`;
function harnessHtml(platform: "threads" | "instagram"): string {
  const links =
    platform === "threads"
      ? [
          ["one", "/@alice/post/ONE-1", "First Threads post"],
          ["two", "/@bob/post/TWO-2", "Second Threads post"],
          ["three", "/@cara/post/THREE-3", "Third Threads post"],
        ]
      : [
          ["one", "/p/PHOTO_1/", "First Instagram post"],
          ["two", "/p/PHOTO_2/", "Second Instagram post"],
          ["three", "/reel/REEL_3/", "Third Instagram reel"],
        ];
  const posts = links
    .map(
      ([id, href, text]) =>
        `<div class="post" id="${id}"><a href="${href}"><time datetime="2026-08-01T10:00:00Z">now</time></a><p>${text}</p></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main>${posts}<input aria-label="Composer" /></main>
    <script>window.__lassoTestPlatform = "${platform}";</script>
    <script>${CHROME_STUB}</script>
    <script type="module" src="./${contentBundle()}"></script>
  </body></html>`;
}

async function openHarness(page: Page, platform: "threads" | "instagram"): Promise<void> {
  writeFileSync(resolve(DIST, `social-${platform}-harness.html`), harnessHtml(platform));
  await page.goto(`${baseUrl}/social-${platform}-harness.html`);
  await expect(page.locator("[data-folder-picker-panel]")).toHaveCount(0);
}

for (const platform of ["threads", "instagram"] as const) {
  test(`${platform}: j/k cursor feeds both Folder shortcuts`, async ({ page }) => {
    await openHarness(page, platform);

    await page.keyboard.press("j");
    await expect(page.locator("#one[data-lasso-cursor='true']")).toHaveCount(1);
    await page.keyboard.press("j");
    await expect(page.locator("#two[data-lasso-cursor='true']")).toHaveCount(1);
    await page.keyboard.press("k");
    await expect(page.locator("#one[data-lasso-cursor='true']")).toHaveCount(1);

    await page.keyboard.press("j");
    await page.keyboard.press("Alt+b");
    await expect(page.locator("[data-folder-picker-panel]")).toBeVisible();
    await expect(page.locator("[data-folder-picker-panel]")).toContainText("Reading");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-folder-picker-panel]")).toHaveCount(0);

    await page.keyboard.press("Alt+Shift+b");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __collections: { lastDefault?: { statusId: string } } })
              .__collections.lastDefault?.statusId,
        ),
      )
      .toBe(`${platform}:${platform === "threads" ? "TWO-2" : "PHOTO_2"}`);

    await page.locator("[aria-label='Composer']").focus();
    await page.keyboard.type("jk");
    await expect(page.locator("[aria-label='Composer']")).toHaveValue("jk");
    await expect(page.locator("#two[data-lasso-cursor='true']")).toHaveCount(1);
  });
}
