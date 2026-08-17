import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real production build and a real database.
 * `npm run build && npm run test:e2e`
 */
/**
 * Set PLAYWRIGHT_CHROMIUM_PATH when Chromium is already installed on the
 * machine (CI images, sandboxes). Otherwise Playwright uses the browser it
 * downloaded with `npx playwright install chromium`.
 */
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --port 3100 --hostname 127.0.0.1",
        url: "http://127.0.0.1:3100/login",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
