import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Structural guard for the "flips then reverts" bug class store-stability pins
 * behaviorally: a `create*()` factory as a Preact component's destructured
 * parameter default re-runs on every render, minting a fresh store + signal
 * each time — an infinite render loop that only manifests in a real browser
 * (happy-dom never sustains it). The fix is always
 * `useMemo(() => prop ?? createX(), [prop])`. This test bans the shape at the
 * source level so a third instance can't land silently.
 */
const BANNED = /[({,]\s*\w+\s*=\s*create[A-Z]\w*\(/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("no store construction in component parameter defaults", () => {
  it("the banned pattern actually matches the historical bug shape", () => {
    expect(BANNED.test("export function OptionsApp({ filter = createFilterStore() }) {")).toBe(
      true,
    );
    expect(BANNED.test("const filter = useMemo(() => prop ?? createFilterStore(), [prop])")).toBe(
      false,
    );
  });

  it("no component file defaults a parameter to a create*() factory", () => {
    const offenders = tsxFiles(join(__dirname, "../../src")).filter((file) =>
      BANNED.test(readFileSync(file, "utf8")),
    );
    expect(
      offenders,
      "param-default store construction loops in production — use useMemo(() => prop ?? createX(), [prop])",
    ).toEqual([]);
  });
});
