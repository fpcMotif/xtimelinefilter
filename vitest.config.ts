import { resolve } from "node:path";

import stylexRollup from "@stylexjs/unplugin/rollup";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    stylexRollup({
      useCSSLayers: true,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: resolve(__dirname),
      },
      aliases: {
        "@/*": [resolve(__dirname, "src/*")],
      },
    }),
  ],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "src/packages/**/tests/*.test.ts",
      "src/packages/**/tests/*.test.tsx",
      "convex/**/*.test.ts",
    ],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      // Frontend/extension code (src) and the Convex Mirror backend (convex),
      // minus codegen. unit-test-design.md §12: the 100% policy extends to the
      // Convex functions the moment they land.
      include: ["src/**", "convex/**"],
      // Ambient declarations carry no runtime code; HTML entry points are not
      // JS and only make v8's instrumenter throw a parse error; convex/_generated
      // is codegen, not hand-written logic.
      // src/packages/*/tests is co-located test code, not product code.
      exclude: [
        "src/types/**",
        "convex/_generated/**",
        "**/*.d.ts",
        "**/*.html",
        "**/*.json",
        "**/*.md",
        "src/packages/**/tests/**",
      ],
      reporter: ["text", "html", "lcov"],
      // Goal: 100% across frontend (content/ui) and backend (background,
      // storage, x-client, convex) logic — see docs/testing/unit-test-design.md.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
