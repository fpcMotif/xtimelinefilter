import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/** Standalone runner for the design-card generator — reuses the repo's happy-dom
    + alias pipeline but is invisible to the normal suite and the coverage gate.
    Run: bunx vitest run -c scripts/design-cards/vitest.config.ts */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "../../src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["scripts/design-cards/generate.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
});
