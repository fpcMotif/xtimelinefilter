import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = resolve(ROOT, "dist");
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

type AxeViolation = {
  id: string;
  impact: string | null;
  nodeCount: number;
  nodes: Array<{ target: string; html: string; failure: string }>;
};

/**
 * The two extension pages, audited the way assistive technology meets them:
 * rendered in real Chromium from the built extension. axe is injected by
 * evaluate, not a <script> tag — extension-page CSP is script-src 'self'.
 */
async function withExtensionPage(
  path: string,
  run: (page: Page) => Promise<void>,
  options: { colorScheme?: "dark" | "light" } = {},
): Promise<void> {
  const profile = await mkdtemp(join(tmpdir(), "lasso-a11y-"));
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
    const page = await context.newPage();
    // Emulate before navigation: post-load scheme switches run the controls'
    // color transitions, and an axe scan can catch a mid-transition color.
    if (options.colorScheme) await page.emulateMedia({ colorScheme: options.colorScheme });
    await page.goto(`${extensionOrigin}/${path}`);
    await run(page);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
}

async function axeScan(page: Page): Promise<AxeViolation[]> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: Document,
            options: unknown,
          ) => Promise<{
            violations: Array<{
              id: string;
              impact: string | null;
              nodes: Array<{ target: string[]; html: string; failureSummary: string }>;
            }>;
          }>;
        };
      }
    ).axe;
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations"],
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodeCount: violation.nodes.length,
      nodes: violation.nodes.map((node) => ({
        target: node.target.join(" "),
        html: node.html.slice(0, 200),
        failure: node.failureSummary.split("\n").slice(1, 3).join(" "),
      })),
    }));
  }, AXE_TAGS);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const violations = await axeScan(page);
  expect(
    violations,
    `axe violations on ${page.url()}:\n${JSON.stringify(violations, null, 2)}`,
  ).toEqual([]);
}

for (const colorScheme of ["dark", "light"] as const) {
  test(`popup passes axe in ${colorScheme} scheme`, async () => {
    await withExtensionPage(
      "src/popup/index.html",
      async (page) => {
        // Wait for the app to settle past its loading state.
        await expect(page.getByRole("checkbox").first()).toBeVisible();
        await expectNoAxeViolations(page);
      },
      { colorScheme },
    );
  });

  test(`options passes axe in ${colorScheme} scheme`, async () => {
    await withExtensionPage(
      "src/options/index.html",
      async (page) => {
        // Settings load from chrome.storage; wait for the real page, not the skeleton.
        await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
        await expectNoAxeViolations(page);
      },
      { colorScheme },
    );
  });
}

test("popup exposes a level-one heading, a stably named master toggle, and a live off-X status", async () => {
  await withExtensionPage("src/popup/index.html", async (page) => {
    await expect(page.getByRole("heading", { name: "Lasso", level: 1 })).toBeVisible();

    // The toggle's accessible name must not change as the armed count changes.
    const master = page.getByRole("checkbox", { name: "Timeline filter" });
    await expect(master).toBeVisible();
    const describedBy = await master.getAttribute("aria-describedby");
    expect(describedBy, "master toggle keeps the armed count as a description").toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(/filter/);

    await expect(page.getByRole("status")).toContainText("Open x.com");
  });
});

test("options exposes nav, labelled radio groups, ordered headings, and a real shortcuts table", async () => {
  await withExtensionPage("src/options/index.html", async (page) => {
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

    await expect(page.getByRole("radiogroup", { name: "Activation" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "How Lasso talks to X" })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Activation", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline filter", level: 2 })).toBeVisible();

    await expect(
      page.getByRole("table", { name: "Keyboard shortcuts available on x.com" }),
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: "Not interested in this post" }),
    ).toBeVisible();

    await expect(page.getByText("No link rules yet.")).toBeVisible();
  });
});

test("filter chips expose their mode as a value and cycle with arrow keys", async () => {
  await withExtensionPage("src/options/index.html", async (page) => {
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    const chip = page.getByRole("slider", { name: "Video" });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("aria-valuetext", "off");

    // Click still cycles, as mouse users expect.
    await chip.click();
    await expect(chip).toHaveAttribute("aria-valuetext", "show only");

    // Arrow keys move through the modes; Home/End jump to the extremes.
    await chip.press("ArrowRight");
    await expect(chip).toHaveAttribute("aria-valuetext", "hide");
    await chip.press("ArrowLeft");
    await expect(chip).toHaveAttribute("aria-valuetext", "show only");
    await chip.press("End");
    await expect(chip).toHaveAttribute("aria-valuetext", "hide");
    await chip.press("Home");
    await expect(chip).toHaveAttribute("aria-valuetext", "off");
  });
});
