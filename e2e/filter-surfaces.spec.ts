import { readdirSync, readFileSync } from "node:fs";
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
  const storage = { local: mkArea("local:"), sync: mkArea("sync:") };
  let settings = {
    backend: "rest",
    activation: "auto",
    highContrast: false,
    surfaces: { pill: true, palette: false },
    pillPosition: { x: 24, y: 96 },
    paletteHotkey: "mod+shift+f",
  };
  const normalizeLanguages = (languages) => [...new Set(languages.map((language) =>
    String(language).split("-")[0].trim().toLowerCase()).filter(Boolean))];
  const filterDefaults = (languages) => ({
    enabled: true,
    criteria: {},
    onlyMyLanguages: false,
    myLanguages: normalizeLanguages(languages),
    linkRules: [],
    presets: [],
    compactHidden: false,
    // MUST stay a complete FilterState: the real client re-validates every
    // worker response against isFilterState, which checks an EXACT key set. A
    // field added to FilterState and missed here makes every command reject,
    // and the store's optimistic update silently rolls back — the chip appears
    // to ignore the click rather than erroring. That is how scopeBindings broke
    // this harness once already.
    scopeBindings: {},
  });
  const filterCommand = async (request) => {
    const key = "lasso:filter";
    let state = (await storage.sync.get(key))[key] || filterDefaults(request.defaultLanguages);
    if (request.operation === "read") return { ok: true, state };
    const command = request.command;
    switch (command.type) {
      case "cycle": {
        const mode = state.criteria[command.id] || "off";
        const next = { off: "only", only: "hide", hide: "off" }[mode];
        if (next === "off") delete state.criteria[command.id];
        else state.criteria = { ...state.criteria, [command.id]: next };
        break;
      }
      case "set-mode":
        if (command.mode === "off") delete state.criteria[command.id];
        else state.criteria = { ...state.criteria, [command.id]: command.mode };
        break;
      case "set-enabled": state.enabled = command.on; break;
      case "set-only-my-languages": state.onlyMyLanguages = command.on; break;
      case "set-my-languages": state.myLanguages = normalizeLanguages(command.languages); break;
      case "set-link-rules": state.linkRules = command.rules; break;
      case "set-compact-hidden": state.compactHidden = command.on; break;
      case "save-preset":
        state.presets = [...state.presets, {
          id: command.id, name: command.name, criteria: { ...state.criteria },
          onlyMyLanguages: state.onlyMyLanguages, myLanguages: [...state.myLanguages],
        }];
        break;
      case "apply-preset": {
        const preset = state.presets.find((candidate) => candidate.id === command.id);
        if (preset) state = { ...state, criteria: { ...preset.criteria },
          onlyMyLanguages: preset.onlyMyLanguages,
          ...(preset.myLanguages ? { myLanguages: [...preset.myLanguages] } : {}) };
        break;
      }
      case "rename-preset":
        state.presets = state.presets.map((preset) => preset.id === command.id ? { ...preset, name: command.name } : preset);
        break;
      case "delete-preset": state.presets = state.presets.filter((preset) => preset.id !== command.id); break;
      case "restore": state = command.state; break;
    }
    await storage.sync.set({ [key]: state });
    return { ok: true, state };
  };
  const coachCommand = async (command) => {
    const key = "lasso:coach";
    const raw = (await storage.local.get(key))[key] || {};
    const state = {
      onboarded: raw.onboarded === true,
      installedAt: Number.isSafeInteger(raw.installedAt) && raw.installedAt >= 0 ? raw.installedAt : undefined,
      assignCount: Number.isSafeInteger(raw.assignCount) && raw.assignCount >= 0 ? Math.min(raw.assignCount, 5) : 0,
      tips: raw.tips && typeof raw.tips === "object" ? { ...raw.tips } : {},
    };
    const now = Date.now();
    const active = (value) => value.installedAt !== undefined && value.assignCount < 5 && now - value.installedAt <= 604800000;
    const stamp = (value) => value.installedAt === undefined ? { ...value, installedAt: now } : value;
    let next = state;
    let result;
    switch (command?.kind) {
      case "is-onboarded": result = { kind: "is-onboarded", onboarded: state.onboarded }; break;
      case "mark-onboarded": next = { ...state, onboarded: true }; result = { kind: "ok" }; break;
      case "record-assign": next = { ...state, assignCount: Math.min(state.assignCount + 1, 5) }; result = { kind: "ok" }; break;
      case "hints-active": next = stamp(state); result = { kind: "hints-active", active: active(next) }; break;
      case "try-show-tip": {
        if (!["first-hover", "unit", "select-nudge", "post-assign"].includes(command.tip) || ![1, 2, 3].includes(command.max)) return { ok: false, error: "Invalid coach command" };
        const eligible = stamp(state);
        const shown = Number.isSafeInteger(eligible.tips[command.tip]) ? eligible.tips[command.tip] : 0;
        if (!active(eligible) || shown >= command.max) result = { kind: "try-show-tip", show: false };
        else { next = { ...eligible, tips: { ...eligible.tips, [command.tip]: shown + 1 } }; result = { kind: "try-show-tip", show: true }; }
        break;
      }
      case "replay-intro": next = { onboarded: false, installedAt: now, assignCount: 0, tips: {} }; result = { kind: "ok" }; break;
      default: return { ok: false, error: "Invalid coach command" };
    }
    if (JSON.stringify(next) !== JSON.stringify(state)) await storage.local.set({ [key]: next });
    return { ok: true, result };
  };
  window.chrome = {
    storage,
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async (request) => {
        if (request?.type === "lasso:settings") {
          if (request.operation === "patch") {
            settings = { ...settings, ...request.patch,
              surfaces: { ...settings.surfaces, ...request.patch.surfaces },
              pillPosition: { ...settings.pillPosition, ...request.patch.pillPosition } };
          }
          return { ok: true, settings };
        }
        if (request?.type === "lasso:filter") return filterCommand(request);
        if (request?.type === "lasso:coach") return coachCommand(request.command);
        if (request?.type === "lasso:list-cache") {
          if (request.operation === "all") return { ok: true, catalogs: [] };
          if (request.operation === "begin") return { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } };
          return { ok: true, lists: request.operation === "commit" ? request.lists : null };
        }
        if (request?.type === "lasso:list-usage") return request.operation === "recent" ? { ok: true, listIds: [] } : { ok: true };
        if (request?.type === "lasso:mirror-status") return request.operation === "read" ? { ok: true, status: null } : { ok: true };
        if (request?.type === "lasso:graphql-catalog") return request.operation === "begin" ? { ok: true, token: { epoch: "00000000-0000-4000-8000-000000000001", sequence: 1 } } : { ok: true, entry: null };
        return {};
      },
    },
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

/** The Video chip is an ARIA slider: one stable name, the mode lives in the value. */
function videoChip(panel: Locator, mode: "off" | "only" | "hide"): Locator {
  return panel
    .getByRole("slider", { name: "Video", exact: true })
    .and(panel.locator(`[data-mode="${mode}"]`));
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
    await expect(videoChip(panel, "off")).toHaveAttribute("data-mode", "off");
    await videoChip(panel, "off").click(); // off → only
    await expect(videoChip(panel, "only")).toHaveAttribute("data-mode", "only");

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
    expect(visibleHandles.toSorted()).toEqual(["alice", "carol"]);

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
    await page
      .locator("#lasso-filter-surfaces [role='dialog']")
      .getByLabel("Preset name")
      .fill("Reading");
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
    await videoChip(reloadedPanel, "only").click(); // only → hide
    await videoChip(reloadedPanel, "hide").click(); // hide → off
    await expect(videoChip(reloadedPanel, "off")).toHaveAttribute("data-mode", "off");
    await expect(page.locator(COLLAPSED)).toHaveCount(0);

    await presetChip.click();
    await expect(videoChip(reloadedPanel, "only")).toHaveAttribute("data-mode", "only");
    await expect(page.locator(COLLAPSED)).toHaveCount(2);
    const handlesAfter = await page.$$eval(
      "[data-testid='cellInnerDiv']:not([data-lasso-filtered]) article",
      (els) => els.map((el) => el.getAttribute("data-handle")),
    );
    expect(handlesAfter.toSorted()).toEqual(["alice", "carol"]);
  });
});
