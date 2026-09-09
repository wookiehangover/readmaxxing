import { test, expect } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";
import { projectedCoverCenter, settleBook } from "./helpers/bookshelf-hit-targets";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 834, height: 1194 },
]) {
  test(`uncovered cover bounding-box corner dismisses while projected center opens at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
    await seedShelf(page, 150);
    const book = page.locator('[data-book-id="stress-149"] .bookshelf-book');
    await book.scrollIntoViewIfNeeded();
    await book.click();
    await expect(book).toHaveAttribute("aria-pressed", "true");
    await settleBook(book);
    const corner = await book.locator(".bookshelf-top").evaluate((cover) => {
      const bounds = cover.getBoundingClientRect();
      for (const [left, top] of [
        [bounds.left + 3, bounds.top + 3],
        [bounds.right - 3, bounds.top + 3],
        [bounds.right - 3, bounds.bottom - 3],
        [bounds.left + 3, bounds.bottom - 3],
      ]) {
        const target = document.elementFromPoint(left, top);
        if (target?.closest(".bookshelf-stack") && target.matches("li, ol")) {
          return { x: left, y: top };
        }
      }
      return null;
    });
    expect(corner, "cover AABB contains a genuinely uncovered shelf corner").not.toBeNull();
    await page.mouse.click(corner!.x, corner!.y);
    await expect(book).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/\/library$/);
    await settleBook(book);
    await book.click();
    await expect(book).toHaveAttribute("aria-pressed", "true");
    const center = await projectedCoverCenter(book);
    expect(center.hitsCover).toBe(true);
    await page.mouse.click(center.x, center.y);
    await expect(page).toHaveURL(/\/books\/stress-149$/);
  });
}
