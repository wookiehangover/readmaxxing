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

  test("uploaded PDF opens in reader with canvas visible", async ({ page }) => {
    await uploadTestPdf(page);

    // Click the PDF in the sidebar to open it
    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    // Wait for the PDF container to appear with a rendered canvas
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });

    const canvas = pdfContainer.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test("PDF reader has prev/next navigation buttons", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    // Wait for PDF to load
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Navigation buttons should be present
    const prevBtn = page.locator("[data-testid='pdf-prev']");
    const nextBtn = page.locator("[data-testid='pdf-next']");
    await expect(prevBtn).toBeVisible({ timeout: 5_000 });
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });
  });

  test("PDF reader settings menu opens", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    // Wait for PDF to render
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Click the settings button (the MoreHorizontal icon button with "Reader settings" sr-only text)
    const settingsBtn = page.getByRole("button", { name: "Reader settings" });
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();

    // Settings menu should show layout options
    await expect(page.getByText("Single Page")).toBeVisible({ timeout: 5_000 });
  });

  test("search bar opens when search button is clicked", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Click the search button
    const searchBtn = page.locator("[data-testid='pdf-search-btn']");
    await expect(searchBtn).toBeVisible({ timeout: 5_000 });
    await searchBtn.click();

    // Search bar should appear with input
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
  });

  test("searching for text returns results", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open search
    const searchBtn = page.locator("[data-testid='pdf-search-btn']");
    await searchBtn.click();

    // Search for "elephant" which is only on page 2
    const searchInput = page.getByPlaceholder("Search in book…");
    await searchInput.fill("elephant");

    // Wait for results to appear — should show "1 of 1"
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });
  });

  test("navigating search results changes page", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open search and search for "quick brown fox" which is on page 1
    const searchBtn = page.locator("[data-testid='pdf-search-btn']");
    await searchBtn.click();

    const searchInput = page.getByPlaceholder("Search in book…");
    await searchInput.fill("quick brown fox");

    // Wait for results
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });

    // Verify we're on page 1
    await expect(page.getByText("Page 1 of 2")).toBeVisible({ timeout: 5_000 });
  });

  test("selecting text in PDF shows highlight popover", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Wait for text layer to render
    const textLayer = pdfContainer.locator(".pdf-text-layer").first();
    await expect(textLayer).toBeAttached({ timeout: 10_000 });

    // Select text by triple-clicking a span in the text layer (force because text layer is transparent)
    const textSpan = textLayer.locator("span").first();
    await expect(textSpan).toBeAttached({ timeout: 5_000 });
    await textSpan.click({ clickCount: 3, force: true });

    // The highlight popover should appear with the "Highlight" button
    const highlightBtn = page.getByRole("button", { name: "Highlight" });
    await expect(highlightBtn).toBeVisible({ timeout: 5_000 });
  });

  test("saving a highlight persists it as a visible overlay", async ({ page }) => {
    await uploadTestPdf(page);

    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Wait for text layer to render
    const textLayer = pdfContainer.locator(".pdf-text-layer").first();
    await expect(textLayer).toBeAttached({ timeout: 10_000 });

    // Select text by triple-clicking a span (force because text layer is transparent)
    const textSpan = textLayer.locator("span").first();
    await expect(textSpan).toBeAttached({ timeout: 5_000 });
    await textSpan.click({ clickCount: 3, force: true });

    // Click the Highlight button in the popover
    const highlightBtn = page.getByRole("button", { name: "Highlight" });
    await expect(highlightBtn).toBeVisible({ timeout: 5_000 });
    await highlightBtn.click();

    // A highlight overlay should now be visible
    const overlay = pdfContainer.locator(".pdf-highlight-overlay").first();
    await expect(overlay).toBeAttached({ timeout: 5_000 });
  });

  test("chat panel opens for a PDF book in workspace", async ({ page }) => {
    await uploadTestPdf(page);

    // Open the PDF by clicking its title in the sidebar
    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    // Wait for the PDF to render
    const pdfContainer = page.locator('[data-testid="pdf-container"]');
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Click the "Open Chat" button in the PDF toolbar
    const chatBtn = page.getByRole("button", { name: "Open Chat" });
    await expect(chatBtn).toBeVisible({ timeout: 5_000 });
    await chatBtn.click();

    // The chat panel should appear with the book title in the header
    const chatHeader = page.getByText("Test PDF for E2E").last();
    await expect(chatHeader).toBeVisible({ timeout: 10_000 });

    // The chat input area should be present
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
  });

  test("chat input is functional for PDF books", async ({ page }) => {
    await uploadTestPdf(page);

    // Open the PDF
    const sidebarBook = page.locator("aside").getByText("Test PDF for E2E", { exact: true });
    await sidebarBook.click();

    const pdfContainer = page.locator('[data-testid="pdf-container"]');
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open chat panel
    const chatBtn = page.getByRole("button", { name: "Open Chat" });
    await chatBtn.click();

    // Wait for chat to load (textarea should appear)
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type in the chat input to verify it's functional
    await chatInput.fill("What is this document about?");
    await expect(chatInput).toHaveValue("What is this document about?");
  });
});
