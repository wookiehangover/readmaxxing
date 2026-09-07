import { test, expect } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
});

for (const width of [390, 1280]) {
  test(`books enter once and scroll into place at ${width}px on /library`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await seedShelf(page, 80);
    await page.goto("/library");
    const first = page.locator('[data-book-id="stress-0"] .bookshelf-book');
    const last = page.locator('[data-book-id="stress-79"] .bookshelf-book');
    await expect(first).toHaveCSS("animation-name", "bookshelf-drop");
    await first.focus();
    // Leaving even partway through the initial drop must permanently retire it.
    await first.evaluate((book) => {
      const animation = book.getAnimations()[0];
      animation.pause();
      animation.currentTime = (animation.effect!.getComputedTiming().delay ?? 0) + 100;
    });

    await last.scrollIntoViewIfNeeded();
    await expect(last.locator(".bookshelf-top")).toBeAttached();
    await expect(first.locator(".bookshelf-top")).toHaveCount(0);
    await expect(first).toBeFocused();
    await expect(last).toHaveCSS("animation-name", "none");
    await expect(last).toHaveCSS("transform", "none");
    await expect(last).toHaveCSS("opacity", "1");

    await first.scrollIntoViewIfNeeded();
    await expect(first.locator(".bookshelf-top")).toBeAttached();
    await expect(first).toHaveCSS("animation-name", "none");
    await expect(first).toHaveCSS("transform", "none");
    await expect(first).toHaveCSS("opacity", "1");
    await expect(first).toBeFocused();

    await page.getByRole("textbox").fill("Stress volume");
    await expect(first.locator(".bookshelf-top")).toBeAttached();
    await expect(first).toHaveCSS("animation-name", "none");

    await page.reload();
    await expect(first).toHaveCSS("animation-name", "bookshelf-drop");
  });
}

test("the selected cover slowly pitches in both directions only while hovered", async ({
  page,
}) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const volume = book.locator(".bookshelf-volume");
  await book.hover();
  await expect(volume).toHaveCSS("animation-name", "none");
  await book.click();
  await page.mouse.move(0, 0);
  await volume.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  const cover = (await book.locator(".bookshelf-top").boundingBox())!;
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await expect(volume).toHaveCSS("animation-name", "bookshelf-pitch");
  await expect(volume).toHaveCSS("animation-duration", "8s");
  const samples = await volume.evaluate((element) => {
    const animation = element.getAnimations().find((item) => item instanceof CSSAnimation)!;
    animation.pause();
    return [0, 2000, 6000, 8000].map((time) => {
      animation.currentTime = time;
      return {
        rotate: getComputedStyle(element).rotate,
        transform: getComputedStyle(element).transform,
      };
    });
  });
  expect(samples.map((sample) => sample.rotate)).toEqual(["x 0deg", "x 7deg", "x -7deg", "x 0deg"]);
  expect(new Set(samples.map((sample) => sample.transform)).size).toBe(1);
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await expect(volume).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await expect(volume).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(book).toHaveAttribute("aria-pressed", "false");
});
