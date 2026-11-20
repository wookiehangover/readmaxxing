import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "html",
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      testMatch: ["bookshelf-camera-origin.spec.ts", "bookshelf-wheel.spec.ts"],
      use: { ...devices["Desktop Safari"] },
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
