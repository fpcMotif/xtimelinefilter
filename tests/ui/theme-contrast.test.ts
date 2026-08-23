import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The published theme contract: `--faint` is the dimmest text color Lasso ships,
 * and it lands on `--background`, `--card`, `--popover`, and `--secondary`
 * surfaces across popup and options. WCAG 2.1 AA requires 4.5:1 for the small
 * text (10–13px) that uses it — in BOTH color schemes, since dark is driven by
 * prefers-color-scheme and the user's OS picks the scheme.
 *
 * This guards the token values themselves so a palette tweak fails here in
 * milliseconds instead of waiting for the browser-level axe audit.
 */

const AA_NORMAL_TEXT = 4.5;

type Oklch = { l: number; c: number; h: number };

/** Relative luminance of an oklch color (OKLab → linear sRGB → Y). */
function luminance({ l, c, h }: Oklch): number {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const r = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrastRatio(first: Oklch, second: Oklch): number {
  const y1 = luminance(first);
  const y2 = luminance(second);
  return (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
}

const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf8");

/** The declarations of one scheme's :root block (light is top-level, dark lives in the media query). */
function schemeDeclarations(scheme: "light" | "dark"): string {
  if (scheme === "dark") {
    const dark = css.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/);
    if (!dark) throw new Error("dark :root block not found in styles.css");
    return dark[1]!;
  }
  const light = css.match(/^:root\s*\{([^}]*)\}/m);
  if (!light) throw new Error("light :root block not found in styles.css");
  return light[1]!;
}

function token(declarations: string, name: string): Oklch {
  const match = declarations.match(new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`));
  if (!match) throw new Error(`--${name} not declared as oklch`);
  const [l, c, h] = match[1]!.trim().split(/\s+/).map(Number);
  return { l: l!, c: c!, h: h! };
}

const SURFACES = ["background", "card", "popover", "secondary"] as const;

describe("theme tokens — faint text stays legible", () => {
  for (const scheme of ["light", "dark"] as const) {
    it(`--faint clears WCAG AA on every surface it lands on (${scheme} scheme)`, () => {
      const declarations = schemeDeclarations(scheme);
      const faint = token(declarations, "faint");
      for (const surface of SURFACES) {
        const ratio = contrastRatio(faint, token(declarations, surface));
        expect(
          ratio,
          `${scheme} --faint on --${surface} is ${ratio.toFixed(2)}:1, below AA ${AA_NORMAL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });
  }
});
