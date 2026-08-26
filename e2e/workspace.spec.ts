import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppHydration } from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");

/** Upload a test epub and wait for its reading route to hydrate. */
async function uploadTestBook(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_EPUB);

  const readingShell = page.getByTestId("reading-shell");
  const mobileReadingTabs = page.getByTestId("mobile-reading-tabs");
  const libraryBook = page.getByRole("button", { name: "Open Test Book for E2E" });
  const readerIsVisible = async () =>
    (await readingShell.isVisible().catch(() => false)) ||
    (await mobileReadingTabs.isVisible().catch(() => false));
  await expect
    .poll(
      async () => (await readerIsVisible()) || (await libraryBook.isVisible().catch(() => false)),
      { timeout: 20_000 },
    )
    .toBe(true);

  if (!(await readerIsVisible())) {
    await libraryBook.click({ force: true, timeout: 5_000 }).catch(() => {});
    await expect.poll(readerIsVisible, { timeout: 20_000 }).toBe(true);
  }
}

/**
 * Upload a book. The first upload auto-opens the reader panel, so we just
 * wait for the reader toolbar to initialize.
 */
async function uploadAndOpenBook(page: Page) {
  await uploadTestBook(page);

  // The book auto-opens on upload (handleBookAdded -> openBook). Wait for the
  // reader toolbar (prev/next buttons) as a signal that the reader is ready.
  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 20_000,
  });
}

test.describe("Workspace route", () => {
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

  test("loads and renders library chrome", async ({ page }) => {
    const navigation = page.getByRole("navigation", { name: "Library navigation" });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Library", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(page.locator('input[type="file"][accept=".epub,.pdf"]').first()).toBeAttached();
  });

  test("upload book via file input and verify it appears in the library", async ({ page }) => {
    await uploadTestBook(page);
    await page.goto("/library");
    await waitForAppHydration(page);
    await expect(page.getByRole("button", { name: "Open Test Book for E2E" })).toBeVisible();
  });

  test("uploaded book opens in a reader panel", async ({ page }) => {
    await uploadAndOpenBook(page);

    await expect(page.getByTestId("reading-shell")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
      timeout: 10_000,
    });
  });

  test("desktop reader opens Details from the reader menu", async ({ page }) => {
    await uploadAndOpenBook(page);

    const tabs = page.getByRole("tablist", { name: "Reading tools" });
    const detailsTab = tabs.getByRole("tab", { name: "Details", exact: true });

    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline"]);
    await page.getByRole("button", { name: "Reader menu" }).first().click();
    await page.getByRole("menuitem", { name: "Details", exact: true }).click();

    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline", "Details"]);
    await expect(detailsTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel").getByRole("heading", { name: "Test Book for E2E", exact: true }),
    ).toBeVisible();

    await tabs.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveText(["Notes", "Discuss", "Outline"]);
    await expect(detailsTab).toHaveCount(0);
  });

  test("mobile reader switches every full-screen tab and keeps the book mounted", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await uploadAndOpenBook(page);

    const mobileReader = page.getByTestId("mobile-reading-tabs");
    const tabs = mobileReader.getByRole("tablist", { name: "Reading sections" });
    const bookSurface = mobileReader.locator(":scope > [aria-label='Book surface']");
    const iframe = bookSurface.locator("iframe").first();

    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveText([
      "Read",
      "Notes",
      "Discuss",
      "Outline",
      "Details",
    ]);
    await expect(tabs.getByRole("tab", { name: "Read", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(bookSurface).toBeVisible();
    await expect(iframe).toBeAttached();
    await iframe.evaluate((element) => element.setAttribute("data-mobile-reader-test", "mounted"));

    for (const name of ["Notes", "Discuss", "Outline", "Details"]) {
      const tab = tabs.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(bookSurface).toBeAttached();
      await expect(iframe).toHaveAttribute("data-mobile-reader-test", "mounted");

      if (name === "Details") {
        await expect(
          mobileReader
            .getByRole("tabpanel")
            .getByRole("heading", { name: "Test Book for E2E", exact: true }),
        ).toBeVisible();
      }
    }

    await tabs.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(bookSurface).toBeVisible();
    await expect(iframe).toHaveAttribute("data-mobile-reader-test", "mounted");
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

  test("search bar opens, finds results, and highlights matches", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Open search with keyboard shortcut
    await page.getByRole("button", { name: "Previous page" }).first().focus();
    await page.keyboard.press("Meta+f");

    // Verify search bar appears — it has an input with placeholder
    const searchInput = page.getByPlaceholder("Search in book…");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type a search query and wait for the debounced search to resolve
    await searchInput.fill("elephant");
    await expect(page.getByText("1 of 1")).toBeVisible({ timeout: 10_000 });

    // The match renders as a highlight decoration in the reader iframe —
    // either through the CSS Custom Highlight API or overlay spans.
    await expect
      .poll(
        async () => {
          let count = 0;
          for (const frame of page.frames()) {
            count += await frame
              .evaluate(
                () =>
                  ((globalThis as { CSS?: { highlights?: { size: number } } }).CSS?.highlights
                    ?.size ?? 0) +
                  document.querySelectorAll("[data-decoration-id^='search-highlight-']").length,
              )
              .catch(() => 0);
          }
          return count;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
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

  test("highlight reference navigate and delete in notebook", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for epub iframe to be ready with content
    const iframe = page.frameLocator("iframe").first();
    const chapterText = iframe.locator("p").first();
    await expect(chapterText).toBeVisible({ timeout: 20_000 });

    // Open the Notes rail FIRST so the callback map is registered.
    const notebookTab = page.getByRole("tab", { name: "Notes" });
    await expect(notebookTab).toBeVisible({ timeout: 10_000 });
    await notebookTab.click();

    // Wait for notebook panel to render
    await page.waitForTimeout(1_000);

    // The reader stays visible beside the notebook in focused mode.
    await expect(chapterText).toBeVisible({ timeout: 15_000 });

    // Programmatically select text inside the epub iframe to trigger epubjs "selected" event
    const iframeHandle = await page.locator("iframe").first().elementHandle();
    if (!iframeHandle) throw new Error("Could not get iframe element handle");
    const iframeFrame = await iframeHandle.contentFrame();
    if (!iframeFrame) throw new Error("Could not get iframe content frame");

    await iframeFrame.evaluate(() => {
      const p = document.querySelector("p");
      if (!p || !p.firstChild) throw new Error("No paragraph found in epub");
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    // Wait for the highlight popover to appear (portaled to document.body)
    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 10_000 });

    // Click "Add to Notebook" to save the highlight
    await highlightBtn.click();

    // Switch to the Notes rail to see the highlight reference.
    await notebookTab.click();

    // Wait for the highlight reference blockquote to appear in the notebook
    const highlightRef = page.locator("blockquote").first();
    await expect(highlightRef).toBeVisible({ timeout: 15_000 });

    // Verify the blockquote contains some highlighted text
    const blockquoteText = await highlightRef.textContent();
    expect(blockquoteText?.length).toBeGreaterThan(0);

    // Test navigate: click the blockquote to navigate to the highlight
    await highlightRef.click();
    // Navigation should focus the reader panel — verify the reader is still showing
    await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
      timeout: 10_000,
    });

    // Test delete: hover the blockquote and click the delete button
    // Re-focus the notebook panel
    await notebookTab.click();

    // Wait for blockquote to be visible again
    const highlightRefAgain = page.locator("blockquote").first();
    await expect(highlightRefAgain).toBeVisible({ timeout: 10_000 });

    // Click the delete button (force: true since it's opacity-hidden until hover)
    const deleteBtn = page.locator('[title="Delete highlight"]').first();
    await deleteBtn.click({ force: true, timeout: 5_000 });

    // Verify the highlight reference blockquote is removed from the notebook
    await expect(page.locator("blockquote")).toHaveCount(0, { timeout: 10_000 });
  });

  test("highlight created with notebook closed appears when notebook opens", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for epub iframe to be ready with content
    const iframe = page.frameLocator("iframe").first();
    const chapterText = iframe.locator("p").first();
    await expect(chapterText).toBeVisible({ timeout: 20_000 });

    // Highlight handlers register after persisted annotations finish loading.
    await page.waitForTimeout(1_000);

    // Do NOT open the notebook first — this is the regression scenario.
    // Select text inside the epub iframe and save a highlight.
    const iframeHandle = await page.locator("iframe").first().elementHandle();
    if (!iframeHandle) throw new Error("Could not get iframe element handle");
    const iframeFrame = await iframeHandle.contentFrame();
    if (!iframeFrame) throw new Error("Could not get iframe content frame");

    await iframeFrame.evaluate(() => {
      const p = document.querySelector("p");
      if (!p || !p.firstChild) throw new Error("No paragraph found in epub");
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });

    const highlightBtn = page.getByRole("button", { name: "Add to Notebook" });
    await expect(highlightBtn).toBeVisible({ timeout: 10_000 });
    await highlightBtn.click();

    // Now open the Notes rail — the highlight reference should already be
    // persisted in IDB via the fallback path, so the blockquote must appear.
    const notebookTab = page.getByRole("tab", { name: "Notes" });
    await expect(notebookTab).toBeVisible({ timeout: 10_000 });
    await notebookTab.click();

    const highlightRef = page.locator("blockquote").first();
    await expect(highlightRef).toBeVisible({ timeout: 15_000 });

    // Exactly one blockquote — no duplicates from a double-write.
    await expect(page.locator("blockquote")).toHaveCount(1);

    // Delete must still work from the fallback-created node.
    const deleteBtn = page.locator('[title="Delete highlight"]').first();
    await deleteBtn.click({ force: true, timeout: 5_000 });
    await expect(page.locator("blockquote")).toHaveCount(0, { timeout: 10_000 });
  });

  test("reader settings menu opens", async ({ page }) => {
    await uploadAndOpenBook(page);

    // Wait for the reader formatting button
    const settingsButton = page.getByRole("button", { name: "Reader menu" });
    await expect(settingsButton.first()).toBeVisible({ timeout: 15_000 });

    // Open settings dropdown
    await settingsButton.first().click();
    await page.getByRole("menuitem", { name: "Formatting" }).hover();

    // Verify layout options are visible
    await expect(page.getByText("Layout")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Single Page")).toBeVisible();
    await expect(page.getByText("Two Page Spread")).toBeVisible();
    await expect(page.getByText("Continuous Scroll")).toBeVisible();
  });
});
