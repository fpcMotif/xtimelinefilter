import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guard: `saved-posts` is the storage brain and nothing else. It
 * knows no Chrome API, no DOM and no surface, so it can be driven from a worker,
 * a test or anywhere else without a browser underneath it.
 *
 * This has to be a SOURCE-level check rather than a runtime one: `tests/setup.ts`
 * installs a global `chrome` mock and the suite runs under happy-dom, so a stray
 * `chrome.storage` or `document` reference would work in tests and only fail in
 * production. Reaching into `@/content` or `@/background` is banned the same way
 * — the package must not acquire a dependency on the trees that own the page and
 * the worker.
 */
const BANNED: Array<{ label: string; pattern: RegExp; bad: string; fine: string }> = [
  {
    label: "chrome API",
    pattern: /(?<![.\w])chrome\s*[.[]/,
    bad: 'await chrome.storage.local.get("folders")',
    fine: "// the worker, not this package, talks to chrome",
  },
  {
    label: "document",
    pattern: /(?<![.\w])document\s*[.[]/,
    bad: 'const el = document.querySelector("article")',
    fine: "/** Reads a post the content script already documented. */",
  },
  {
    label: "window",
    pattern: /(?<![.\w])window\s*[.[]/,
    bad: "window.indexedDB.open(name)",
    fine: "// a bounded page, never a whole-store window",
  },
  {
    label: "ambient global",
    pattern: /(?<![.\w])globalThis\s*[.[]/,
    bad: "const factory = globalThis.indexedDB",
    fine: "constructor(private readonly db: IDBDatabase) {}",
  },
  {
    // Matches a bare `@/content` too, and a dynamic `import("@/background/…")`.
    label: "content/background import",
    pattern: /["']@\/(?:content|background)(?:\/|["'])/,
    bad: 'import { Selectors } from "@/content/selectors"',
    fine: 'import { mintFolderId } from "./ids"',
  },
];

const PACKAGE_DIR = join(__dirname, "../../src/packages/saved-posts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("saved-posts is headless and standalone", () => {
  it("each banned pattern matches the shape it bans and spares the shape it does not", () => {
    for (const { label, pattern, bad, fine } of BANNED) {
      expect(pattern.test(bad), `${label} should match: ${bad}`).toBe(true);
      expect(pattern.test(fine), `${label} should spare: ${fine}`).toBe(false);
    }
  });

  it("scans a non-empty set of package files", () => {
    // Guards the guard: a moved or renamed package would otherwise make every
    // assertion below vacuously true.
    expect(sourceFiles(PACKAGE_DIR).length).toBeGreaterThan(5);
  });

  it("no file under the package touches Chrome, the DOM or an ambient global", () => {
    const offenders = sourceFiles(PACKAGE_DIR).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return BANNED.filter(({ pattern }) => pattern.test(source)).map(
        ({ label }) => `${file.slice(file.indexOf("src/"))}: ${label}`,
      );
    });
    expect(
      offenders,
      "saved-posts must stay drivable without a browser — inject what you need instead",
    ).toEqual([]);
  });
});
