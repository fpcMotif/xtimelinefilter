import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Locator, type Page, test } from "@playwright/test";

// Drives the funnel pill end-to-end (task-017 scenario) against the REAL built
// content bundle in headless Chromium with a stubbed chrome.* API — same harness
// shape as content.spec.ts: no extension loading (so no display needed) and no
// live X account. The bundle's code-split chunks resolve over local HTTP from
// dist/assets.
//
// Two divergences from content.spec.ts, both load-bearing for this scenario:
//   1. The harness is served at the IN-SCOPE path "/home" (route.ts only lets the
//      filter run on Home / List timelines), so collapses actually apply.
//   2. chrome.storage is backed by the page's localStorage instead of a fresh
//      in-memory object, so the saved preset survives the reload assertion.
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
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    // Serve the harness document for the in-scope timeline route(s); everything
    // else is a real asset (the content chunk + its code-split imports).
    if (pathname === "/home" || pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(harnessHtml());
      return;
    }
    try {
      const path = resolve(DIST, `.${pathname}`);
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

// chrome.storage stub backed by localStorage so writes survive a reload — the
// whole point of the persistence beat. Each area namespaces its keys so sync and
// local never collide. Mirrors the async chrome.storage.* surface the code uses.
const CHROME_STUB = `(() => {
  const mkArea = (ns) => ({
    get: async (k) => {
      const all = {};
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        if (!full || !full.startsWith(ns)) continue;
        all[full.slice(ns.length)] = JSON.parse(localStorage.getItem(full));
      }
      if (k == null) return { ...all };
      const out = {};
      for (const key of [].concat(k)) if (key in all) out[key] = all[key];
      return out;
    },
    set: async (items) => {
      for (const [key, val] of Object.entries(items)) {
        localStorage.setItem(ns + key, JSON.stringify(val));
      }
    },
    remove: async (ks) => {
      for (const key of [].concat(ks)) localStorage.removeItem(ns + key);
    },
  });
  window.chrome = {
    storage: { local: mkArea("local:"), sync: mkArea("sync:") },
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
  };
})();`;

// A mixed timeline: two video cells, two non-video (text + photo). Video uses the
// FacetSelectors.VIDEO hook ([data-testid="videoPlayer"]); the others deliberately
// lack it. Each cell carries the cellInnerDiv / article / tweet hooks the scanner,
// facet extractor and filter-applier key on.
const TIMELINE_CELLS = [
  { handle: "alice", text: "ship day", video: true },
  { handle: "bob", text: "just some words", video: false },
  { handle: "carol", text: "another clip", video: true },
  { handle: "dave", text: "a photo post", video: false, photo: true },
];

function cellHtml(c: (typeof TIMELINE_CELLS)[number], i: number): string {
  const media = c.video
    ? '<div data-testid="videoPlayer"><video></video></div>'
    : c.photo
      ? '<div data-testid="tweetPhoto"><img src="x"></div>'
      : "";
  return `<div data-testid="cellInnerDiv">
    <article data-testid="tweet" role="article" data-handle="${c.handle}">
      <div data-testid="User-Name">
        <div><a href="/${c.handle}"><span>${c.handle}</span></a></div>
        <div><a href="/${c.handle}"><span>@${c.handle}</span></a>·<a href="/${c.handle}/status/${i + 1}"><time>1h</time></a></div>
      </div>
      <div data-testid="tweetText" lang="en">${c.text}</div>
      ${media}
      <button data-testid="caret" aria-label="More"></button>
    </article>
  </div>`;
}

function harnessHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
  <div data-testid="primaryColumn">
    ${TIMELINE_CELLS.map(cellHtml).join("\n")}
  </div>
  <script>${CHROME_STUB}</script>
  <script type="module" src="/${contentBundle()}"></script>
</body></html>`;
}

/** The in-page filter surfaces live in their own open Shadow host. */
function pillRoot(page: Page): Locator {
  return page.locator("#lasso-filter-surfaces [data-funnel-pill-root]");
}

function funnelButton(page: Page): Locator {
  return pillRoot(page).getByRole("button", { name: "Timeline filter" });
}

/**
 * Dismiss the first-run welcome card. On a fresh storage it is always shown (a
 * full-screen modal that intercepts clicks), set asynchronously after the coach's
 * onboarding read resolves — so we wait for it, then Skip. After onboarding (e.g.
 * the post-reload run, since coach state persists) it never appears; tolerate that.
 */
async function dismissWelcome(page: Page): Promise<void> {
  const skip = page.getByText("Skip", { exact: true });
  try {
    await skip.waitFor({ state: "visible", timeout: 2000 });
  } catch {
    return; // already onboarded — no card to dismiss
  }
  await skip.click();
  await expect(skip).toBeHidden();
}

async function openHome(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/home`);
  // Wait for the content bundle to mount its surfaces into the Shadow host.
  await expect(funnelButton(page)).toBeVisible();
  await dismissWelcome(page);
}

// data-lasso-filtered marks a collapsed cell; the injected stub carries the text.
const COLLAPSED = "[data-testid='cellInnerDiv'][data-lasso-filtered]";
const STUB = "[data-lasso-filter-stub]";

test.describe("filter surfaces (real bundle, chrome stubbed)", () => {
  test.beforeEach(async ({ page }) => {
    // Each test owns a clean storage so presets/onboarding never leak across runs.
    await page.goto(`${baseUrl}/home`);
    await page.evaluate(() => localStorage.clear());
  });

  test("funnel pill: Video=only collapses non-video to reversible stubs, badge counts, preset persists across reload", async ({
    page,
  }) => {
    await openHome(page);

    // Given the timeline harness with mixed posts, nothing is hidden at rest
    // (zero criteria ⇒ the filter is a no-op) and the badge shows no count.
    await expect(page.locator(COLLAPSED)).toHaveCount(0);
    const badge = funnelButton(page).locator("span[aria-hidden='true']");
    await expect(badge).toHaveCount(0);

    // When I open the funnel pill and set "Video" to "only" …
    await funnelButton(page).click();
    const panel = page.locator("#lasso-filter-surfaces [role='dialog']");
    await expect(panel).toBeVisible();
    const video = panel.getByRole("button", { name: "Video", exact: true });
    await expect(video).toHaveAttribute("data-mode", "off");
    await video.click(); // off → only
    await expect(video).toHaveAttribute("data-mode", "only");

    // Then non-video cells collapse to the "· hidden — show" stub and video
    // cells remain. Two video posts stay; the text + photo posts collapse.
    await expect(page.locator(COLLAPSED)).toHaveCount(2);
    await expect(page.locator(STUB)).toHaveCount(2);
    for (const stub of await page.locator(STUB).all()) {
      await expect(stub).toHaveText("· hidden — show");
    }
    // The surviving (non-collapsed) cells are exactly the two video posts.
    const visibleHandles = await page.$$eval(
      "[data-testid='cellInnerDiv']:not([data-lasso-filtered]) article",
      (els) => els.map((el) => el.getAttribute("data-handle")),
    );
    expect(visibleHandles.sort()).toEqual(["alice", "carol"]);

    // And the pill badge shows an active count (one active criterion).
    await expect(badge).toHaveText("1");

    // The stub is reversible: clicking "show" un-hides that one cell only.
    await page.locator(STUB).first().click();
    await expect(page.locator(COLLAPSED)).toHaveCount(1);

    // Clicking the timeline stub above is an outside-click that closes the
    // popover (expected UX), so re-open the pill before saving the preset.
    await funnelButton(page).click();
    await expect(panel).toBeVisible();

    // When I save the current filter as a preset "Reading" …
    await page.locator("#lasso-filter-surfaces [role='dialog']").getByLabel("Preset name").fill(
      "Reading",
    );
    await page
      .locator("#lasso-filter-surfaces [role='dialog']")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    // The preset chip appears in the panel.
    await expect(
      page.locator("#lasso-filter-surfaces [role='dialog']").getByRole("button", {
        name: "Reading",
        exact: true,
      }),
    ).toBeVisible();

    // … and I reload the page.
    await page.reload();
    await expect(funnelButton(page)).toBeVisible();
    await dismissWelcome(page);

    // The persisted filter (Video=only) re-applies on its own: the same two
    // non-video posts are collapsed again (the per-cell "show" override is not
    // captured by the preset and does not persist, so all non-video collapse).
    await expect(page.locator(COLLAPSED)).toHaveCount(2);
    await expect(funnelButton(page).locator("span[aria-hidden='true']")).toHaveText("1");

    // Then the "Reading" preset is still present after reload.
    await funnelButton(page).click();
    const reloadedPanel = page.locator("#lasso-filter-surfaces [role='dialog']");
    await expect(reloadedPanel).toBeVisible();
    const presetChip = reloadedPanel.getByRole("button", { name: "Reading", exact: true });
    await expect(presetChip).toBeVisible();

    // And applying it re-establishes "Video: only" and the same cells hidden.
    // First turn Video off so applying the preset is what restores the state.
    const videoAfter = reloadedPanel.getByRole("button", { name: "Video", exact: true });
    await videoAfter.click(); // only → hide
    await videoAfter.click(); // hide → off
    await expect(videoAfter).toHaveAttribute("data-mode", "off");
    await expect(page.locator(COLLAPSED)).toHaveCount(0);

    await presetChip.click();
    await expect(videoAfter).toHaveAttribute("data-mode", "only");
    await expect(page.locator(COLLAPSED)).toHaveCount(2);
    const handlesAfter = await page.$$eval(
      "[data-testid='cellInnerDiv']:not([data-lasso-filtered]) article",
      (els) => els.map((el) => el.getAttribute("data-handle")),
    );
    expect(handlesAfter.sort()).toEqual(["alice", "carol"]);
  });
});
