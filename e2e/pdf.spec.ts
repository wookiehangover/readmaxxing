import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_PDF = resolve(__dirname, "fixtures/test-document.pdf");

/**
 * Upload a test PDF via the hidden file input in the sidebar.
 * Returns once the book title appears in the sidebar.
 */
async function uploadTestPdf(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_PDF);

  // Wait for the PDF to appear in the sidebar
  const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
  await expect(sidebarBook).toBeVisible({ timeout: 15_000 });
}

test.describe("PDF support", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for client-side hydration — the workspace route is the index
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    // Clear IndexedDB to start with a clean state
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
    });

    // Reload after clearing storage to get a fresh state
    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
  });

  test("upload a PDF and verify it appears in sidebar", async ({ page }) => {
    await uploadTestPdf(page);

    // Verify the PDF title appears in the sidebar
    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await expect(sidebarBook).toBeVisible();
  });

  test("PDF shows correct author in sidebar", async ({ page }) => {
    await uploadTestPdf(page);

    // The author should appear somewhere in the sidebar near the book
    const author = page.locator("aside").getByText("Test PDF Author");
    await expect(author).toBeVisible({ timeout: 10_000 });
  });
});
