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

test("the selected cover follows the pointer and settles when it leaves", async ({ page }) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const volume = book.locator(".bookshelf-volume");
  await book.hover();
  await expect(volume).toHaveCSS("rotate", "0deg");
  await book.click();
  await page.mouse.move(0, 0);
  await volume.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  const baseTransform = await volume.evaluate((element) => getComputedStyle(element).transform);
  const cover = (await book.locator(".bookshelf-cover").boundingBox())!;
  const samples: number[][] = [];
  for (const [x, y] of [
    [0.3, 0.3],
    [0.7, 0.7],
  ]) {
    await page.mouse.move(cover.x + cover.width * x, cover.y + cover.height * y);
    await expect
      .poll(() => volume.evaluate((element) => element.style.getPropertyValue("--book-tilt")))
      .not.toBe("");
    await volume.evaluate(async (element) => {
      await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    });
    samples.push(
      await volume.evaluate((element) =>
        getComputedStyle(element).rotate.split(" ").map(parseFloat),
      ),
    );
    await expect(volume).toHaveCSS("transform", baseTransform);
    await expect(book).toHaveAttribute("aria-pressed", "true");
  }
  // Opposite corners tilt on both axes; the selection transform remains unchanged.
  expect(samples[0][0]).toBeGreaterThan(0);
  expect(samples[0][1]).toBeLessThan(0);
  expect(samples[1][0]).toBeLessThan(0);
  expect(samples[1][1]).toBeGreaterThan(0);
  const glare = book.locator(".bookshelf-cover");
  await expect
    .poll(() => glare.evaluate((element) => getComputedStyle(element, "::after").opacity))
    .toBe("0.2");
  await page.mouse.move(0, 0);
  await expect(volume).toHaveCSS("rotate", "0deg");
  await expect
    .poll(() => glare.evaluate((element) => getComputedStyle(element, "::after").opacity))
    .toBe("0");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(cover.x + cover.width * 0.7, cover.y + cover.height * 0.7);
  await expect(volume).toHaveCSS("rotate", "0deg");
  await page.keyboard.press("Escape");
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect(volume).toHaveCSS("rotate", "0deg");
});

test("the selected book keeps six joined faces and an opaque back cover", async ({ page }) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  await book.click();
  await page.mouse.move(0, 0);
  const volume = book.locator(".bookshelf-volume");
  await volume.evaluate(async (element) => {
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
  });
  const faces = book.locator(
    ".bookshelf-top, .bookshelf-back, .bookshelf-spine, .bookshelf-pages, .bookshelf-page-end",
  );
  await expect(faces).toHaveCount(6);
  const corners = await faces.evaluateAll((elements) =>
    elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const width = parseFloat(style.width);
      const height = parseFloat(style.height);
      const [originX, originY] = style.transformOrigin.split(" ").map(parseFloat);
      const matrix = new DOMMatrix(style.transform);
      return [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ].map(([x, y]) => {
        const point = new DOMPoint(x - originX, y - originY, 0).matrixTransform(matrix);
        return [
          point.x + originX + (element as HTMLElement).offsetLeft,
          point.y + originY + (element as HTMLElement).offsetTop,
          point.z,
        ];
      });
    }),
  );
  // A closed cuboid has eight corners, each shared by exactly three faces.
  const vertices: { point: number[]; count: number }[] = [];
  for (const point of corners) {
    const match = vertices.find((vertex) =>
      vertex.point.every((value, axis) => Math.abs(value - point[axis]) < 1),
    );
    if (match) match.count++;
    else vertices.push({ point, count: 1 });
  }
  expect(vertices).toHaveLength(8);
  expect(vertices.map((vertex) => vertex.count)).toEqual(Array(8).fill(3));
  const spine = book.locator(".bookshelf-spine");
  expect((await spine.boundingBox())!.width).toBeGreaterThan(10);
  expect(
    await spine.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
      );
    }),
  ).toBe(true);
  // Inspect the reverse of the same object: the front must not show through it.
  await volume.evaluate((element) => {
    element.style.transition = "none";
    element.style.rotate = "y 180deg";
  });
  expect(
    await book.locator(".bookshelf-back").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element
      );
    }),
  ).toBe(true);
});
