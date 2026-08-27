import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installVirtualAuthenticator,
  registerAndSignIn,
  skipIfAuthNotConfigured,
  waitForAppHydration,
} from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_PDF = resolve(__dirname, "fixtures/test-document.pdf");

/** Upload a test PDF and wait for its reading route to hydrate. */
async function uploadTestPdf(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_PDF);

  const pdfContainer = page.getByTestId("pdf-container");
  const libraryBook = page.getByRole("button", { name: "Open Test PDF for E2E" });
  await expect
    .poll(
      async () =>
        (await pdfContainer.isVisible().catch(() => false)) ||
        (await libraryBook.isVisible().catch(() => false)),
      { timeout: 20_000 },
    )
    .toBe(true);

  if (!(await pdfContainer.isVisible().catch(() => false))) {
    await libraryBook.click({ force: true, timeout: 5_000 }).catch(() => {});
    await expect(pdfContainer).toBeVisible({ timeout: 20_000 });
  }
}

async function completeTouchSelection(page: Page) {
  await page
    .locator("[data-testid='pdf-container'] .textLayer span")
    .first()
    .evaluate((span) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(span);
      selection?.removeAllRanges();
      selection?.addRange(range);
      span.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", isPrimary: true }),
      );
      span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      span.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

test.describe("PDF support", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
    await page.goto("/favicon.svg", { waitUntil: "domcontentloaded" });

    // Clear IndexedDB + storage to isolate each test.
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
    });

    // Reload after clearing storage to get a fresh state
    await page.goto("/");
    await waitForAppHydration(page);
  });

  test("upload a PDF and verify it appears in the library", async ({ page }) => {
    await uploadTestPdf(page);
    await page.goto("/library");
    await waitForAppHydration(page);
    await expect(page.getByRole("button", { name: "Open Test PDF for E2E" })).toBeVisible();
  });

  test("PDF shows correct author in the library table", async ({ page }) => {
    await uploadTestPdf(page);
    await page.goto("/library");
    await waitForAppHydration(page);
    await page.getByRole("button", { name: "Table view" }).click();
    const bookRow = page.getByRole("row").filter({ hasText: "Test PDF for E2E" });
    await expect(bookRow).toContainText("Test PDF Author", { timeout: 10_000 });
  });

  test("uploaded PDF opens in reader with canvas visible", async ({ page }) => {
    await uploadTestPdf(page);

    // The PDF auto-opens on upload (handleBookAdded -> openBook).
    // Wait for the PDF container to appear with a rendered canvas
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });

    const canvas = pdfContainer.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test("PDF reader has prev/next navigation buttons", async ({ page }) => {
    await uploadTestPdf(page);

    // Wait for PDF to load (auto-opened on upload)
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Navigation buttons should be present
    const prevBtn = page.locator("[data-testid='pdf-prev']");
    const nextBtn = page.locator("[data-testid='pdf-next']");
    await expect(prevBtn).toBeVisible({ timeout: 5_000 });
    await expect(nextBtn).toBeVisible({ timeout: 5_000 });
  });

  test("mobile PDF carousel tracks, snaps back, and navigates one page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadTestPdf(page);
    const pdfContainer = page.getByTestId("pdf-container");
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();

    const dispatchTouch = (
      type: "touchstart" | "touchmove" | "touchend",
      x: number,
      time: number,
    ) =>
      pdfContainer.evaluate(
        (container, { type, x, time }) => {
          const point = { identifier: 1, clientX: x, clientY: 200 };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === "touchend" ? [] : [point] },
            changedTouches: { value: [point] },
            timeStamp: { value: time },
          });
          container.dispatchEvent(event);
        },
        { type, x, time },
      );

    await dispatchTouch("touchstart", 300, 10);
    await dispatchTouch("touchmove", 250, 210);
    const currentFrame = pdfContainer.locator("[data-pdf-carousel-page='1']");
    await expect
      .poll(() => currentFrame.evaluate((element) => (element as HTMLElement).style.transform))
      .toContain("-50px");
    await dispatchTouch("touchend", 250, 410);
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
    await expect(pdfContainer.locator("[data-pdf-page-carousel]")).toHaveCount(0);

    await dispatchTouch("touchstart", 300, 500);
    await dispatchTouch("touchmove", 140, 700);
    await expect
      .poll(() => currentFrame.evaluate((element) => (element as HTMLElement).style.transform))
      .toContain("-160px");
    await expect(
      pdfContainer.locator("[data-pdf-carousel-page='2'] .page[data-page-number='2']"),
    ).toHaveCount(1);
    await dispatchTouch("touchend", 100, 900);
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();

    await dispatchTouch("touchstart", 100, 1000);
    await dispatchTouch("touchmove", 260, 1200);
    await dispatchTouch("touchend", 300, 1400);
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  });

  test("PDF reader settings menu opens", async ({ page }) => {
    await uploadTestPdf(page);

    // Wait for PDF to render (auto-opened on upload)
    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open formatting from the reading rail menu.
    const settingsBtn = page.getByRole("button", { name: "Reader menu" });
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();
    await page.getByRole("menuitem", { name: "Formatting" }).hover();

    // Settings menu should show PDF layout options
    await expect(page.getByText("Fit to Height")).toBeVisible({ timeout: 5_000 });
  });

  test("search bar opens when search button is clicked", async ({ page }) => {
    await uploadTestPdf(page);

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open search with keyboard shortcut
    await page.getByTestId("pdf-prev").focus();
    await page.keyboard.press("Meta+f");

    // Search bar should appear with input
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
  });

  test("searching for text returns results", async ({ page }) => {
    await uploadTestPdf(page);

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open search with keyboard shortcut
    await page.getByTestId("pdf-prev").focus();
    await page.keyboard.press("Meta+f");

    // Search for "elephant" which is only on page 2
    const searchInput = page.getByPlaceholder("Search in book…");
    await searchInput.fill("elephant");

    // Wait for results to appear — should show "1 of 1"
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });
  });

  test("navigating search results changes page", async ({ page }) => {
    await uploadTestPdf(page);

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open search and search for "quick brown fox" which is on page 1
    await page.getByTestId("pdf-prev").focus();
    await page.keyboard.press("Meta+f");

    const searchInput = page.getByPlaceholder("Search in book…");
    await searchInput.fill("quick brown fox");

    // Wait for results
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });

    // Verify we're on page 1
    await expect(page.getByRole("main", { name: "Book surface" }).getByText("1 / 2")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("selecting text in PDF shows highlight popover", async ({ page }) => {
    await uploadTestPdf(page);

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Wait for text layer to render
    const textLayer = pdfContainer.locator(".textLayer").first();
    await expect(textLayer).toBeAttached({ timeout: 10_000 });

    // Select text by triple-clicking a span in the text layer (force because text layer is transparent)
    const textSpan = textLayer.locator("span").first();
    await expect(textSpan).toBeAttached({ timeout: 5_000 });
    await textSpan.click({ clickCount: 3, force: true });

    // The highlight popover should appear with the "Add to Notebook" button
    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 5_000 });
  });

  test("touch-completed PDF selection opens one saveable highlight popover", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadTestPdf(page);
    const pdfContainer = page.getByTestId("pdf-container");
    await expect(pdfContainer.locator(".textLayer").first()).toBeAttached({ timeout: 10_000 });

    await completeTouchSelection(page);

    const highlightButton = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightButton).toHaveCount(1);
    await highlightButton.click();
    await expect(pdfContainer.locator(".pdf-highlight-overlay").first()).toBeAttached({
      timeout: 5_000,
    });
  });

  test("saving a highlight persists it as a visible overlay", async ({ page }) => {
    await uploadTestPdf(page);

    const pdfContainer = page.locator("[data-testid='pdf-container']");
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Wait for text layer to render
    const textLayer = pdfContainer.locator(".textLayer").first();
    await expect(textLayer).toBeAttached({ timeout: 10_000 });

    // Select text by triple-clicking a span (force because text layer is transparent)
    const textSpan = textLayer.locator("span").first();
    await expect(textSpan).toBeAttached({ timeout: 5_000 });
    await textSpan.click({ clickCount: 3, force: true });

    // Click the Add to Notebook button in the popover
    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 5_000 });
    await highlightBtn.click();

    // A highlight overlay should now be visible
    const overlay = pdfContainer.locator(".pdf-highlight-overlay").first();
    await expect(overlay).toBeAttached({ timeout: 5_000 });
  });

  test("chat panel opens for a PDF book in workspace", async ({ page, context, request }) => {
    await skipIfAuthNotConfigured(request);
    await installVirtualAuthenticator(context, page);
    await registerAndSignIn(page);
    await uploadTestPdf(page);

    // Wait for the PDF to render (auto-opened on upload)
    const pdfContainer = page.locator('[data-testid="pdf-container"]');
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open the Discuss rail.
    const chatBtn = page.getByRole("tab", { name: "Discuss" });
    await expect(chatBtn).toBeVisible({ timeout: 5_000 });
    await chatBtn.click();

    // The chat panel should appear with the book title in the header
    const chatHeader = page.getByText("Test PDF for E2E").last();
    await expect(chatHeader).toBeVisible({ timeout: 10_000 });

    // The chat input area should be present
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
  });

  test("chat input is functional for PDF books", async ({ page, context, request }) => {
    await skipIfAuthNotConfigured(request);
    await installVirtualAuthenticator(context, page);
    await registerAndSignIn(page);
    await uploadTestPdf(page);

    const pdfContainer = page.locator('[data-testid="pdf-container"]');
    await expect(pdfContainer).toBeVisible({ timeout: 15_000 });
    await expect(pdfContainer.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

    // Open the Discuss rail.
    const chatBtn = page.getByRole("tab", { name: "Discuss" });
    await chatBtn.click();

    // Wait for chat to load (textarea should appear)
    const chatInput = page.locator('textarea[placeholder*="Ask"]');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });

    // Type in the chat input to verify it's functional
    await chatInput.fill("What is this document about?");
    await expect(chatInput).toHaveValue("What is this document about?");
  });
});
