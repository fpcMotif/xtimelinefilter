import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/types/**"],
      reporter: ["text", "html", "lcov"],
      // Goal: 100% across frontend (content/ui) and backend (background,
      // storage, x-client) logic — see docs/testing/unit-test-design.md.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
