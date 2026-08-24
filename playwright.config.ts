import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Enable parallel execution for better performance
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Use 2 workers in CI, up to 4 locally for better performance
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "html",
  // Global timeout settings to prevent hanging tests
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    // Reduce video/screenshot overhead
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.CI
      ? "node --env-file-if-exists=.env ./node_modules/@react-router/serve/bin.cjs ./build/server/index.js"
      : `pnpm exec react-router dev --port ${port}`,
    env: process.env.CI ? { PORT: String(port), BLOB_STORAGE_BACKEND: "local" } : undefined,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
