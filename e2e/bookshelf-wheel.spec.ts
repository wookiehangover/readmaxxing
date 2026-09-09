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
      const [samples] = await Promise.all([
        book.evaluate(async (element) => {
          const viewport = element.closest(".bookshelf")!;
          const read = () => ({
            scroll: viewport.scrollTop,
            origin: parseFloat(
              element
                .querySelector<HTMLElement>(".bookshelf-scene")!
                .style.getPropertyValue("--shelf-camera-y"),
            ),
          });
          const samples = [read()];
          await new Promise<void>((resolve) =>
            viewport.addEventListener("scroll", () => resolve(), { once: true }),
          );
          const end = performance.now() + 700;
          while (performance.now() < end) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            samples.push(read());
          }
          return samples;
        }),
        page.mouse.wheel(0, delta),
      ]);
      const first = samples[0];
      const last = samples.at(-1)!;
      expect(last.scroll - first.scroll).toBeCloseTo(delta, 0);
      expect(Math.abs(last.origin - first.origin)).toBeGreaterThan(10);
      const direction = Math.sign(last.origin - first.origin);
      for (const [index, sample] of samples.slice(1).entries()) {
        expect((sample.origin - samples[index].origin) * direction).toBeGreaterThanOrEqual(-0.01);
      }
      const settlingFrames = samples.slice(1).filter((sample, index) => {
        const previous = samples[index];
        return sample.scroll === previous.scroll && Math.abs(sample.origin - previous.origin) > 0.1;
      });
      if (reducedMotion === "no-preference") {
        expect(settlingFrames.length).toBeGreaterThan(2);
      } else {
        expect(settlingFrames.length).toBeLessThanOrEqual(1);
      }
      expect(last.origin).toBe(samples.at(-2)!.origin);
    }
  });
}
