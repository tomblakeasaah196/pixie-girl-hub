import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * Local: `bun run e2e` boots `bun run dev` on :8080 and runs the suite.
 * CI / preview: set PLAYWRIGHT_BASE_URL to point at a deployed preview URL.
 */
const PORT = Number(process.env.PORT ?? 8080);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 8_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "bun run dev",
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
