import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

// Exercises the REAL built content bundle in headless Chromium with a stubbed
// chrome.* API — no extension loading (so no display needed) and no live X
// account. The harness page is served over local HTTP from dist/assets so the
// bundle's code-split chunks resolve; without an X session the picker lands on
// the designed logged-out error beat, which is itself part of the story (beat 8).
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
      const path = resolve(DIST, `.${new URL(req.url ?? "/", "http://x").pathname}`);
      res.setHeader("content-type", MIME[extname(path)] ?? "application/octet-stream");
      res.end(readFileSync(path));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((done) => server.close(done));
});

function contentBundle(): string {
  // The real content chunk, NOT the crxjs `main.tsx-loader-*.js` shim (which
  // needs chrome.runtime.getURL and the extension runtime).
  const file = readdirSync(DIST).find(
    (n) => /^main\.tsx-.*\.js$/.test(n) && !n.includes("-loader-"),
  );
  if (!file) throw new Error("Build the extension first: `bun run build`");
  return file;
}

const CHROME_STUB = `(() => {
  const mkArea = () => { let d = {}; return {
    get: async (k) => (k ? (k in d ? { [k]: d[k] } : {}) : { ...d }),
    set: async (i) => { d = { ...d, ...i }; },
    remove: async (ks) => { for (const k of [].concat(ks)) delete d[k]; },
  }; };
  window.chrome = {
    storage: { local: mkArea(), sync: mkArea() },
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
  };
})();`;

// Mimics live X's caret menu: opens on caret click, removes itself on an
// accepted row click, then swaps the tweet article for a testid-less feedback
// article (the shape verified live 2026-06-12).
const CARET_MENU_FIXTURE = `(() => {
  document.querySelector('[data-testid="caret"]').addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div role="menuitem">Not interested in this post</div>';
    menu.querySelector('[role="menuitem"]').addEventListener('click', () => {
      menu.remove();
      const cell = document.querySelector('[data-testid="cellInnerDiv"]');
      cell.querySelector('article').remove();
      cell.insertAdjacentHTML('beforeend',
        '<article><button>Undo</button><button>Show fewer from @jack</button><button>This post is not relevant</button></article>');
      window.__nifeedback = [];
      for (const b of cell.querySelectorAll('article button')) {
        b.addEventListener('click', () => window.__nifeedback.push(b.textContent));
      }
    });
    document.body.appendChild(menu);
  });
})();`;

function harnessHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-testid="primaryColumn">
    <div data-testid="cellInnerDiv">
      <article data-testid="tweet" role="article">
        <div data-testid="User-Name">
          <div><a href="/jack"><span>Jack</span></a></div>
          <div><a href="/jack"><span>@jack</span></a>·<a href="/jack/status/1"><time>1h</time></a></div>
        </div>
        <p>hello timeline</p>
        <button data-testid="caret" aria-label="More"></button>
      </article>
    </div>
  </div>
  <script>${CHROME_STUB}</script>
  <script>${CARET_MENU_FIXTURE}</script>
  <script type="module" src="./${contentBundle()}"></script>
</body></html>`;
}

async function openHarness(page: Page): Promise<void> {
  writeFileSync(resolve(DIST, "e2e-harness.html"), harnessHtml());
  await page.goto(`${baseUrl}/e2e-harness.html`);
}

test.describe("content UI (real bundle, chrome stubbed)", () => {
  test("first-run story: welcome → select → picker error beat → shortcuts", async ({ page }) => {
    await openHarness(page);

    // Beat 3 — the welcome card, three gestures, one trust fact.
    await expect(page.getByText("Lasso is ready")).toBeVisible();
    await expect(
      page.getByText("Lasso runs entirely in your browser. Nothing leaves x.com."),
    ).toBeVisible();
    await page.getByText("Skip", { exact: true }).click();
    await expect(page.getByText("Lasso is ready")).toBeHidden();

    // Beat 4 — checks are hidden until hover; click selects the PERSON.
    const overlay = page.getByRole("button", { name: /select this author/i });
    await page.hover("article");
    await expect(overlay).toBeVisible();
    await overlay.click();
    await expect(page.getByText("1 person selected")).toBeVisible();

    // Beat 8 — no session here, so the picker lands on the designed error beat.
    await page.getByText("Add to List").click();
    await expect(page.getByText("Couldn't load your Lists")).toBeVisible();
    await expect(page.getByText("You may be logged out of X")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Couldn't load your Lists")).toBeHidden();

    // Beat 5 — ? opens the live-keymap sheet with the trust footer.
    await page.keyboard.press("?");
    await expect(page.getByText("Keyboard shortcuts")).toBeVisible();
    await expect(page.getByText(/Lasso never overrides them/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Keyboard shortcuts")).toBeHidden();
  });

  test("Alt+N drives the caret menu and reports verified not-interested feedback", async ({
    page,
  }) => {
    await openHarness(page);
    await page.getByText("Skip", { exact: true }).click();

    // Hover targets the post (mousemove → hoveredSticky), Alt+N hides it.
    await page.hover("article");
    await page.keyboard.press("Alt+n");

    // Success toast only after the verified X-side effect (panel appeared).
    await expect(page.getByText("Hidden — told X you're not interested")).toBeVisible();
    // The post-level "not relevant" feedback was clicked — never Undo.
    await expect
      .poll(async () => page.evaluate(() => (window as { __nifeedback?: string[] }).__nifeedback))
      .toEqual(["This post is not relevant"]);
  });

  test("select mode: s shows the bar at zero count; post-body clicks toggle", async ({ page }) => {
    await openHarness(page);

    await page.getByText("Skip", { exact: true }).click();
    await page.keyboard.press("s");
    await expect(
      page.getByText("Select mode · click posts or press x · s when done"),
    ).toBeVisible();

    // Clicking anywhere on the post body toggles its author (beat 7).
    await page.getByText("hello timeline").click();
    await expect(page.getByText("1 person selected")).toBeVisible();
    await page.getByText("hello timeline").click();
    await expect(
      page.getByText("Select mode · click posts or press x · s when done"),
    ).toBeVisible();
  });
});
