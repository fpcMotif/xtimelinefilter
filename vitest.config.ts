import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "convex/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
