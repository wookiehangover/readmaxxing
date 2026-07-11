import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.EPUB_SUCCESSOR_E2E_PORT ?? 4_179);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: `pnpm exec vite . --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/demo/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
