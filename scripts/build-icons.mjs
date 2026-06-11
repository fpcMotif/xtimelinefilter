// Rasterizes public/icons/lasso.svg into the manifest's PNG sizes.
// Run after editing the glyph: `bun run icons`. Outputs are committed so the
// build never depends on this step.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = resolve(root, "public/icons/lasso.svg");
// Toolbar/store icons render on light and dark chrome — paint the glyph in a
// neutral ink that reads on both (currentColor has no meaning outside a page).
const svg = readFileSync(svgPath, "utf8").replaceAll("currentColor", "#0f1419");

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0,0,0,0)",
  }).render();
  const out = resolve(root, `public/icons/lasso-${size}.png`);
  writeFileSync(out, png.asPng());
  console.log("wrote", out);
}
