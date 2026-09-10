import { test, expect } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";
import { settleBookshelfCamera } from "./helpers/bookshelf-camera";

for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`wheel camera motion with ${reducedMotion} motion preference`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
    await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
    await seedShelf(page, 80);
    const book = page.locator('[data-book-id="stress-1"] .bookshelf-book');
    await settleBookshelfCamera(book);
    const shelf = page.locator(".bookshelf");
    const bounds = (await shelf.boundingBox())!;
    await page.mouse.move(bounds.x + 10, bounds.y + bounds.height / 2);

    for (const delta of [120, -120]) {
      const scene = book.locator(".bookshelf-scene");
      const origin = () =>
        scene.evaluate((element) =>
          parseFloat((element as HTMLElement).style.getPropertyValue("--shelf-camera-y")),
        );
      const initialOrigin = await origin();
      const initialScroll = await shelf.evaluate((element) => element.scrollTop);
      const wheel = await shelf.evaluateHandle((element) => {
        const result = { canceled: null as boolean | null };
        element.addEventListener(
          "wheel",
          (event) =>
            queueMicrotask(() => {
              result.canceled = event.defaultPrevented;
            }),
          { once: true, passive: true },
        );
        return result;
      });
      try {
        await page.mouse.wheel(0, delta);
        await expect.poll(() => wheel.evaluate((result) => result.canceled)).toBe(false);
      } finally {
        await wheel.dispose();
      }
      await expect
        .poll(() => shelf.evaluate((element) => element.scrollTop))
        .toBeCloseTo(initialScroll + delta, 0);
      await settleBookshelfCamera(book);
      const finalOrigin = await origin();
      expect((finalOrigin - initialOrigin) * Math.sign(delta)).toBeGreaterThan(10);
      if (reducedMotion === "no-preference") {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect.poll(origin).toBeCloseTo(finalOrigin, 0);
        await page.emulateMedia({ reducedMotion });
      }
    }
  });
}
