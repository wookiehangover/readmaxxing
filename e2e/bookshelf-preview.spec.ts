import { test, expect, type Locator } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

async function projectedFace(face: Locator) {
  return face.evaluate((element) => {
    const corners = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ].map(([left, top]) => {
      const point = document.createElement("span");
      point.style.cssText = `position:absolute;left:${left}%;top:${top}%;width:0;height:0;pointer-events:none`;
      element.append(point);
      const bounds = point.getBoundingClientRect();
      point.remove();
      return { x: bounds.x, y: bounds.y };
    });
    return {
      corners,
      facingCamera:
        corners.reduce((area, point, index) => {
          const next = corners[(index + 1) % corners.length];
          return area + point.x * next.y - next.x * point.y;
        }, 0) > 20,
    };
  });
}

for (const { width, height } of [
  { width: 390, height: 500 },
  { width: 390, height: 844 },
  { width: 768, height: 844 },
  { width: 1280, height: 844 },
]) {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`oblique preview fits at different scroll positions at ${width}x${height} with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
      await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
      await seedShelf(page, 80);
      await page.mouse.move(0, 0);
      const book = page.locator('[data-book-id="stress-30"] .bookshelf-book');
      const row = book.locator("..");
      let firstCover: { x: number; y: number; width: number; height: number } | undefined;

      for (const fraction of [0.2, 0.5, 0.8]) {
        await book.scrollIntoViewIfNeeded();
        await book.evaluate((element, position) => {
          const shelf = element.closest(".bookshelf")!;
          const spine = element.querySelector(".bookshelf-spine")!.getBoundingClientRect();
          shelf.scrollTop +=
            spine.top +
            spine.height / 2 -
            shelf.getBoundingClientRect().top -
            shelf.clientHeight * position;
          element.focus({ preventScroll: true });
        }, fraction);
        await book.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await page.keyboard.press("Enter");
        await expect(book).toHaveAttribute("aria-pressed", "true");
        await row.evaluate(async (element) => {
          await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        await expect(book.locator(".bookshelf-volume")).toHaveCSS("rotate", "0deg");
        const cover = await projectedFace(book.locator(".bookshelf-cover"));
        const [topLeft, topRight, bottomRight, bottomLeft] = cover.corners;
        const topWidth = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
        const bottomWidth = Math.hypot(bottomRight.x - bottomLeft.x, bottomRight.y - bottomLeft.y);
        expect(cover.facingCamera).toBe(true);
        expect(topWidth).toBeLessThan(bottomWidth * 0.98);
        expect(topWidth).toBeGreaterThan(bottomWidth * 0.85);
        expect(bottomLeft.x).toBeGreaterThan(topLeft.x + 10);
        expect((await projectedFace(book.locator(".bookshelf-spine"))).facingCamera).toBe(true);
        expect((await projectedFace(book.locator(".bookshelf-page-end-finish"))).facingCamera).toBe(
          true,
        );

        const shelf = (await page.locator(".bookshelf").boundingBox())!;
        const bounds = (await book.locator(".bookshelf-cover").boundingBox())!;
        let lowestFace = 0;
        for (const selector of [
          ".bookshelf-cover",
          ".bookshelf-spine",
          ".bookshelf-page-end-finish",
        ]) {
          const face = (await book.locator(selector).boundingBox())!;
          expect(face.x).toBeGreaterThanOrEqual(shelf.x);
          expect(face.x + face.width).toBeLessThanOrEqual(shelf.x + shelf.width);
          expect(face.y).toBeGreaterThanOrEqual(shelf.y);
          lowestFace = Math.max(lowestFace, face.y + face.height);
        }
        const actions = (await row.locator(".bookshelf-actions").boundingBox())!;
        expect(actions.y).toBeGreaterThan(lowestFace + 8);
        expect(actions.y + actions.height).toBeLessThan(shelf.y + shelf.height);
        expect(actions.x).toBeGreaterThanOrEqual(shelf.x);
        expect(actions.x + actions.width).toBeLessThanOrEqual(shelf.x + shelf.width);
        expect(bounds.height).toBeGreaterThan(bounds.width * 1.25);
        if (firstCover) {
          expect(bounds.x).toBeCloseTo(firstCover.x, 0);
          expect(bounds.width).toBeCloseTo(firstCover.width, 0);
          expect(bounds.height).toBeCloseTo(firstCover.height, 0);
          if (width >= 768) expect(bounds.y).toBeCloseTo(firstCover.y, 0);
        }
        firstCover = bounds;
        await page.keyboard.press("Escape");
        await expect(book).toHaveAttribute("aria-pressed", "false");
        await expect(book).toBeFocused();
        await row.evaluate(async (element) => {
          await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
      }
    });
  }
}
