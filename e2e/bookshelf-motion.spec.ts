import { test, expect } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
});

for (const width of [390, 1280]) {
  for (const route of ["/bookshelf", "/library"]) {
    test(`books enter once and scroll into place at ${width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await seedShelf(page, 80);
      await page.goto(route);
      const first = page.locator('[data-book-id="stress-0"] .bookshelf-book');
      const last = page.locator('[data-book-id="stress-79"] .bookshelf-book');
      await expect(first).toHaveCSS("animation-name", "bookshelf-drop");
      // Leaving even partway through the initial drop must permanently retire it.
      await first.evaluate((book) => {
        const animation = book.getAnimations()[0];
        animation.pause();
        animation.currentTime = (animation.effect!.getComputedTiming().delay ?? 0) + 100;
      });

      await last.scrollIntoViewIfNeeded();
      await expect(last.locator(".bookshelf-top")).toBeAttached();
      await expect(first.locator(".bookshelf-top")).toHaveCount(0);
      await expect(last).toHaveCSS("animation-name", "none");
      await expect(last).toHaveCSS("transform", "none");
      await expect(last).toHaveCSS("opacity", "1");

      await first.scrollIntoViewIfNeeded();
      await expect(first.locator(".bookshelf-top")).toBeAttached();
      await expect(first).toHaveCSS("animation-name", "none");
      await expect(first).toHaveCSS("transform", "none");
      await expect(first).toHaveCSS("opacity", "1");

      await page.getByRole(route === "/bookshelf" ? "searchbox" : "textbox").fill("Stress volume");
      await expect(first.locator(".bookshelf-top")).toBeAttached();
      await expect(first).toHaveCSS("animation-name", "none");

      await page.reload();
      await expect(first).toHaveCSS("animation-name", "bookshelf-drop");
    });
  }
}
