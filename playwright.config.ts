import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  outputDir: ".amp/in/playwright-results",
  reporter: "list",
  retries: 0,
  testDir: "./tests/e2e",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3010",
    channel: "chromium",
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "off",
    trace: "off",
    viewport: { height: 1000, width: 1440 },
  },
  workers: 1,
});
