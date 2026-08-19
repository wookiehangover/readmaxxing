import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");

async function resetLibrary(page: Page) {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.goto("/favicon.svg", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    for (const database of databases) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
    localStorage.clear();
  });
  await page.goto("/library");
  await expect(page.locator('[data-slot="library-mobile-navigation"]')).toBeVisible();
}

test.describe("Mobile library", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens a library book in the Read tab", async ({ page }) => {
    await resetLibrary(page);

    const mobileNavigation = page.locator('[data-slot="library-mobile-navigation"]');
    await expect(mobileNavigation).toBeVisible();
    await expect(page.locator('[data-slot="library-header-navigation"]')).toBeHidden();

    await page.locator('input[type="file"][accept=".epub,.pdf"]').first().setInputFiles(TEST_EPUB);
    const libraryBook = page.getByRole("button", { name: "Open Test Book for E2E" });
    const mobileReader = page.getByTestId("mobile-reading-tabs");
    await expect
      .poll(
        async () =>
          (await libraryBook.isVisible().catch(() => false)) ||
          (await mobileReader.isVisible().catch(() => false)),
        { timeout: 20_000 },
      )
      .toBe(true);

    await page.goto("/library");
    await expect(mobileNavigation).toBeVisible();
    await libraryBook.click();

    await expect(page).toHaveURL(/\/books\/[^/]+$/);
    await expect(mobileReader).toBeVisible();
    await expect(mobileReader.getByRole("tab", { name: "Read" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
