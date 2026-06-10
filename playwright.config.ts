import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { headless: true },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
