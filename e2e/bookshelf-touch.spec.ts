import { test, expect } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";
import { projectedCoverCenter, tapBookGutter } from "./helpers/bookshelf-hit-targets";

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 834, height: 1194 },
]) {
  test(`large touch library survives repeated selection at ${viewport.width}px on /library`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("crash", () => errors.push("Page crashed"));
    await seedShelf(page, 150);
    await page.goto("/library");
    await expect(page.locator(".bookshelf-book")).toHaveCount(153);
    const first = page.locator('[data-book-id="stress-0"] .bookshelf-book');
    const last = page.locator('[data-book-id="stress-149"] .bookshelf-book');
    await expect(first.locator(".bookshelf-cover img")).toBeAttached();
    await expect(last.locator(".bookshelf-top")).toHaveCount(0);
    await expect(last).toHaveCSS("perspective", "none");
    await expect(last.locator(".bookshelf-volume")).toHaveCSS("transform-style", "flat");

    for (const book of [first, last, first]) {
      await book.scrollIntoViewIfNeeded();
      await expect(book.locator(".bookshelf-cover img")).toBeAttached();
      for (let attempt = 0; attempt < 3; attempt++) {
        await book.locator("..").evaluate(async (row) => {
          await Promise.allSettled(
            row.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        await book.tap();
        await expect(book).toHaveAttribute("aria-pressed", "true");
        const cover = book.locator(".bookshelf-top");
        await expect
          .poll(async () => {
            const bounds = (await cover.boundingBox())!;
            return bounds.height / bounds.width;
          })
          .toBeGreaterThan(1.25);
        await expect.poll(() => page.locator(".bookshelf-cover img").count()).toBeLessThan(18);
        await tapBookGutter(page, book);
        await expect(book).toHaveAttribute("aria-pressed", "false");
        await expect(page).toHaveURL(/\/library$/);
        await expect(book.locator(".bookshelf-book-title")).toHaveCSS(
          "text-decoration-line",
          "none",
        );
        await expect(book).toHaveCSS("outline-style", "none");
      }
    }
    await expect(last.locator(".bookshelf-top")).toHaveCount(0);
    for (const book of [first, last, first]) {
      await book.scrollIntoViewIfNeeded();
      await book.tap();
      await expect(book).toHaveAttribute("aria-pressed", "true");
      const id = await book.locator("..").getAttribute("data-book-id");
      const center = await projectedCoverCenter(book);
      expect(center.hitsCover).toBe(true);
      await page.touchscreen.tap(center.x, center.y);
      await expect(page).toHaveURL(new RegExp(`/books/${id}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/library$/);
      await expect(page.locator(".bookshelf-book")).toHaveCount(153);
    }
    expect(errors).toEqual([]);
  });
}
