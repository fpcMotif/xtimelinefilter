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
  const storage = { local: mkArea(), sync: mkArea() };
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
      page.getByText(
        "Lasso never sends your X session credentials to the Mirror. Mirror sync is off until you configure it.",
      ),
    ).toBeVisible();
    await page.getByText("Skip", { exact: true }).click();
    await expect(page.getByText("Lasso is ready")).toBeHidden();

    // Beat 4 — checks are hidden until hover; click selects the PERSON.
    const overlay = page.getByRole("button", { name: "Select @jack" });
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
