import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

// Exercises the REAL built content bundle in headless Chromium with a stubbed
// chrome.* API — no extension loading (so no display needed) and no live X
// account. The DOM backend finds no Lists dialog, so the picker opens empty;
// that's enough to prove the inject → select → action-bar → picker flow.
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/assets");

function contentBundle(): string {
  const file = readdirSync(DIST).find((n) => /^main\.tsx-.*\.js$/.test(n));
  if (!file) throw new Error("Build the extension first: `bun run build`");
  return resolve(DIST, file);
}

const TIMELINE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-testid="primaryColumn">
    <article data-testid="tweet" role="article">
      <div data-testid="User-Name">
        <div><a href="/jack"><span>Jack</span></a></div>
        <div><a href="/jack"><span>@jack</span></a>·<a href="/jack/status/1"><time>1h</time></a></div>
      </div>
    </article>
  </div>
</body></html>`;

test.describe("content UI (real bundle, chrome stubbed)", () => {
  test("injects overlay, selects an author, opens the list picker", async ({ page }) => {
    await page.setContent(TIMELINE);
    // Stub chrome.* in the page context (ordered before the bundle).
    await page.addScriptTag({
      content: `(() => {
        const mkArea = () => { let d = {}; return {
          get: async (k) => (k ? (k in d ? { [k]: d[k] } : {}) : { ...d }),
          set: async (i) => { d = { ...d, ...i }; },
        }; };
        window.chrome = { storage: { local: mkArea(), sync: mkArea() }, runtime: { onMessage: { addListener() {} } } };
      })();`,
    });
    await page.addScriptTag({ path: contentBundle(), type: "module" });

    const overlay = page.getByRole("button", { name: /select this author/i });
    await expect(overlay).toBeVisible();
    await overlay.click();

    await expect(page.getByText("1 selected")).toBeVisible();

    await page.getByText("Add to list").click();
    await expect(page.getByText("No matching lists")).toBeVisible();
  });
});
