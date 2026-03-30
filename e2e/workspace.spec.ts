import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");

/**
 * Upload a test epub via the hidden file input in the sidebar.
 * Returns once the book title appears in the sidebar.
 */
async function uploadTestBook(page: Page) {
  // The sidebar has a hidden file input for epub uploads — use .first() since
  // the watermark panel also has one
  const fileInput = page.locator('input[type="file"][accept=".epub"]').first();
  await fileInput.setInputFiles(TEST_EPUB);

  // Wait for the book to appear in the sidebar — target the sidebar button specifically
  const sidebarBook = page.locator("aside").getByText("Test Book for E2E", { exact: true });
  await expect(sidebarBook).toBeVisible({ timeout: 15_000 });
}

/**
 * Upload a book and open it in a reader panel, waiting for the reader toolbar.
 */
async function uploadAndOpenBook(page: Page) {
  await uploadTestBook(page);

  // Click the book entry in the sidebar to open it
  const sidebarBook = page.locator("aside").getByText("Test Book for E2E", { exact: true });
  await sidebarBook.click();

  // Wait for a dockview panel tab with the book to appear and reader to initialize
  // Use the prev/next buttons as a signal that the reader is ready
  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 20_000,
  });
}

test.describe("Workspace route", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for client-side hydration — the workspace route is the index
    // The dockview container should be present once hydrated
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

  test("loads and renders dockview and sidebar", async ({ page }) => {
    // Verify dockview renders
    const dockview = page.locator(".dv-dockview");
    await expect(dockview).toBeVisible();

    // Verify sidebar renders — it contains the hidden file input and action buttons
    // The sidebar has a "Settings" link
    await expect(page.getByTitle("Settings")).toBeVisible();
  });

  test("upload book via file input and verify it appears in sidebar", async ({ page }) => {
    await uploadTestBook(page);

    // Verify the book title is now in the sidebar
    const bookEntry = page.locator("aside").getByText("Test Book for E2E", { exact: true });
    await expect(bookEntry).toBeVisible();
  });

  test("uploaded book opens in a reader panel", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Verify a dockview panel tab appeared
    await expect(page.locator(".dv-default-tab").first()).toBeVisible({ timeout: 10_000 });
  });

  test("reader has navigation buttons", async ({ page }) => {
    await uploadAndOpenBook(page);

    const prevButton = page.getByRole("button", { name: "Previous page" });
    const nextButton = page.getByRole("button", { name: "Next page" });

    await expect(prevButton.first()).toBeAttached();
    await expect(nextButton.first()).toBeAttached();

    // Click next — should not throw
    await nextButton.first().click();
  });

  test("search bar opens and accepts input", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Click the search button
    await page.getByRole("button", { name: "Search in book" }).first().click();

    // Verify search bar appears — it has an input with placeholder
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query
    await searchInput.fill("elephant");

    // Press enter to trigger search
    await searchInput.press("Enter");
  });

  test("TOC popover opens when book has table of contents", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for the TOC button to appear (only shows when book has TOC)
    const tocButton = page.getByRole("button", { name: "Table of Contents" });
    await expect(tocButton.first()).toBeVisible({ timeout: 15_000 });

    // Click the TOC button
    await tocButton.first().click();

    // Verify TOC popover content — should show chapter titles
    // Use .first() since TOC entries may appear in both sidebar and reader popovers
    await expect(
      page.getByRole("button", { name: "Chapter 1: The Beginning" }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Chapter 2: The End" }).first()).toBeVisible();
  });

  test("reader settings menu opens", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for the reader settings button
    const settingsButton = page.getByRole("button", { name: "Reader settings" });
    await expect(settingsButton.first()).toBeVisible({ timeout: 15_000 });

    // Open settings dropdown
    await settingsButton.first().click();

    // Verify layout options are visible
    await expect(page.getByText("Layout")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Single Page")).toBeVisible();
    await expect(page.getByText("Two Page Spread")).toBeVisible();
    await expect(page.getByText("Continuous Scroll")).toBeVisible();
  });
});
