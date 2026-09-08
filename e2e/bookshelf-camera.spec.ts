import { test, expect, type Locator } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

async function placeBook(book: Locator, fraction: number) {
  await book.evaluate((element, position) => {
    const shelf = element.closest(".bookshelf")!;
    const spine = element.querySelector(".bookshelf-spine")!.getBoundingClientRect();
    const viewport = shelf.getBoundingClientRect();
    shelf.scrollTop += spine.top + spine.height / 2 - viewport.top - shelf.clientHeight * position;
  }, fraction);
  await book.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function faces(book: Locator) {
  return book.evaluate((element) => {
    const spine = element.querySelector(".bookshelf-spine")!.getBoundingClientRect();
    const top = element.querySelector(".bookshelf-top")!;
    const back = element.querySelector(".bookshelf-back")!;
    const topBounds = top.getBoundingClientRect();
    const backBounds = back.getBoundingClientRect();
    return {
      coverDepth: spine.top - topBounds.top,
      backDepth: backBounds.bottom - spine.bottom,
      topBackface: getComputedStyle(top).backfaceVisibility,
      backBackface: getComputedStyle(back).backfaceVisibility,
    };
  });
}

for (const width of [390, 1280]) {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`camera follows the shelf viewport at ${width}px with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
      await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
      await seedShelf(page, 80);
      await page.mouse.move(0, 0);
      const book = page.locator('[data-book-id="stress-30"] .bookshelf-book');
      await book.scrollIntoViewIfNeeded();
      await expect(book.locator(".bookshelf-top")).toBeAttached();
      await expect(book).toHaveCSS("animation-name", "none");

      async function checkCamera() {
        await placeBook(book, 0.8);
        const lower = await faces(book);
        expect(lower.coverDepth).toBeGreaterThan(10);
        expect(lower.topBackface).toBe("hidden");
        expect(lower.backBackface).toBe("hidden");
        await placeBook(book, 0.65);
        const nearer = await faces(book);
        expect(nearer.coverDepth).toBeGreaterThan(0);
        expect(nearer.coverDepth).toBeLessThan(lower.coverDepth - 5);
        await placeBook(book, 0.5);
        const central = await faces(book);
        expect(central.coverDepth).toBeCloseTo(0, 0);
        expect(central.backDepth).toBeCloseTo(0, 0);
        await placeBook(book, 0.2);
        const upper = await faces(book);
        expect(upper.coverDepth).toBeCloseTo(0, 0);
        expect(upper.backDepth).toBeLessThan(8);
      }

      await checkCamera();
      await page.setViewportSize({ width: width === 390 ? 430 : 1024, height: 704 });
      await checkCamera();
      await page.locator('[data-book-id="stress-79"] .bookshelf-book').scrollIntoViewIfNeeded();
      await expect(book.locator(".bookshelf-top")).toHaveCount(0);
      await book.scrollIntoViewIfNeeded();
      await expect(book.locator(".bookshelf-top")).toBeAttached();
      await checkCamera();
      await expect
        .poll(() => page.locator('.bookshelf-scene[data-active="true"]').count())
        .toBeLessThan(16);
      expect(
        await page
          .locator(".bookshelf")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    });
  }
}
