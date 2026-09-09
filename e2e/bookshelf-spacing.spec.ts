import { test, expect, type Locator } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";
import { settleBookshelfCamera } from "./helpers/bookshelf-camera";

async function projectedBooks(stack: Locator) {
  return stack.evaluate((element) => {
    const shelf = element.closest(".bookshelf")!.getBoundingClientRect();
    return Array.from(element.querySelectorAll<HTMLElement>('li[data-active="true"]'), (row) => {
      const faces = Array.from(
        row.querySelectorAll<HTMLElement>(
          ".bookshelf-top, .bookshelf-back, .bookshelf-spine, .bookshelf-pages, .bookshelf-page-end",
        ),
        (face) => {
          const style = getComputedStyle(face);
          const faceWidth = parseFloat(style.width);
          const faceHeight = parseFloat(style.height);
          const borderLeft = parseFloat(style.borderLeftWidth);
          const borderTop = parseFloat(style.borderTopWidth);
          const corners = [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ].map(([left, top]) => {
            const point = document.createElement("span");
            point.style.cssText = `position:absolute;left:${(left / 100) * faceWidth - borderLeft}px;top:${(top / 100) * faceHeight - borderTop}px;width:0;height:0;pointer-events:none`;
            face.append(point);
            const bounds = point.getBoundingClientRect();
            point.remove();
            return { x: bounds.x, y: bounds.y };
          });
          const area = corners.reduce((sum, point, index) => {
            const next = corners[(index + 1) % corners.length];
            return sum + point.x * next.y - next.x * point.y;
          }, 0);
          return { name: face.className, corners, facingCamera: area > 1 };
        },
      );
      const visible = faces.filter((face) => face.facingCamera).flatMap((face) => face.corners);
      const spine = row.querySelector(".bookshelf-spine")!.getBoundingClientRect();
      return {
        id: row.dataset.bookId,
        faces,
        top: Math.min(...visible.map((point) => point.y)),
        bottom: Math.max(...visible.map((point) => point.y)),
        spineTop: spine.top,
        spineBottom: spine.bottom,
        spineWidth: spine.width,
        inViewport: spine.bottom > shelf.top && spine.top < shelf.bottom,
      };
    });
  });
}

test("matches the measured Stripe reference proportions and cover progression", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1878, height: 1344 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
  await seedShelf(page, 80);
  await page.mouse.move(0, 0);
  const stack = page.locator(".bookshelf-stack");
  await expect
    .poll(async () => (await projectedBooks(stack)).filter((row) => row.inViewport).length)
    .toBeGreaterThanOrEqual(6);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const books = (await projectedBooks(stack)).filter((row) => row.spineTop >= 72).slice(0, 6);
  expect(books[0].spineTop).toBeGreaterThanOrEqual(80);
  expect(books[0].spineTop).toBeLessThanOrEqual(100);
  const expectedDepths = [0, 0.04, 0.22, 0.38, 0.53, 0.68];
  for (const [index, current] of books.entries()) {
    const spineHeight = current.spineBottom - current.spineTop;
    expect(current.spineWidth / 1878).toBeGreaterThan(0.49);
    expect(current.spineWidth / 1878).toBeLessThan(0.51);
    expect(spineHeight / current.spineWidth).toBeGreaterThan(0.13);
    expect(spineHeight / current.spineWidth).toBeLessThan(0.14);
    const depth = (current.spineTop - current.top) / spineHeight;
    expect(Math.abs(depth - expectedDepths[index])).toBeLessThan(0.04);
    if (index > 0) {
      const previous = books[index - 1];
      const pitch = (current.spineTop - previous.spineTop) / current.spineWidth;
      expect(pitch).toBeGreaterThan(0.245);
      expect(pitch).toBeLessThan(0.26);
      expect(current.top - previous.bottom).toBeGreaterThan(18);
    }
  }
  const middle = books[2];
  const lower = books[4];
  const middleDepth = middle.spineTop - middle.top;
  const slope = (lower.spineTop - lower.top - middleDepth) / (lower.spineTop - middle.spineTop);
  const horizon = middle.spineTop - middleDepth / slope;
  expect(horizon / 1344).toBeGreaterThan(0.18);
  expect(horizon / 1344).toBeLessThan(0.23);
});

for (const [width, height] of [
  [390, 500],
  [390, 844],
  [1280, 844],
  [1878, 1344],
  [1535, 1663],
  [390, 1663],
  [768, 1663],
  [1535, 2400],
]) {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`projected books stay joined and separated at ${width}x${height} with ${reducedMotion} motion`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion });
      await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
      await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
      await seedShelf(page, 80);
      await page.mouse.move(0, 0);
      const stack = page.locator(".bookshelf-stack");
      const book = page.locator('[data-book-id="stress-30"] .bookshelf-book');
      await book.scrollIntoViewIfNeeded();
      await expect(book.locator(".bookshelf-top")).toBeAttached();

      for (const fraction of [0.1, 0.4, 0.7, 0.95]) {
        await settleBookshelfCamera(book);
        await book.evaluate((element, position) => {
          const shelf = element.closest(".bookshelf")!;
          const spine = element.querySelector(".bookshelf-spine")!.getBoundingClientRect();
          shelf.scrollTop +=
            spine.top +
            spine.height / 2 -
            shelf.getBoundingClientRect().top -
            shelf.clientHeight * position;
        }, fraction);
        await expect
          .poll(async () => {
            const books = (await projectedBooks(stack)).filter((candidate) => candidate.inViewport);
            return books.length;
          })
          .toBeGreaterThan(2);
        await stack.evaluate(async (element) => {
          await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        await settleBookshelfCamera(book);
        const books = await projectedBooks(stack);
        for (const [index, current] of books.entries()) {
          if (!current.inViewport) continue;
          expect(current.faces).toHaveLength(6);
          expect(current.spineTop - current.top).toBeLessThanOrEqual(current.spineWidth * 0.103);
          const vertices: { point: { x: number; y: number }; count: number }[] = [];
          for (const point of current.faces.flatMap((face) => face.corners)) {
            const match = vertices.find(
              (vertex) => Math.hypot(vertex.point.x - point.x, vertex.point.y - point.y) < 2.5,
            );
            if (match) match.count++;
            else vertices.push({ point, count: 1 });
          }
          expect(vertices.every((vertex) => vertex.count >= 3)).toBe(true);
          const previous = books[index - 1];
          if (previous) {
            const gap = current.top - previous.bottom;
            expect(gap, `${previous.id} to ${current.id}`).toBeGreaterThanOrEqual(14);
            expect(gap).toBeLessThanOrEqual(Math.max(58, current.spineWidth * 0.122));
          }
        }
        const target = books.find((candidate) => candidate.id === "stress-30")!;
        if (fraction <= 0.1) {
          expect(target.faces.find((face) => face.name === "bookshelf-top")!.facingCamera).toBe(
            false,
          );
        }
        if (fraction >= 0.7) {
          expect((target.spineTop - target.top) / target.spineWidth).toBeGreaterThan(
            fraction === 0.95 ? 0.075 : 0.045,
          );
        }
      }

      if (reducedMotion === "no-preference") {
        await book.locator(".bookshelf-spine").hover();
        await book.evaluate(async (element) => {
          await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        const books = await projectedBooks(stack);
        const index = books.findIndex((candidate) => candidate.id === "stress-30");
        expect(books[index].top - books[index - 1].bottom).toBeGreaterThan(8);
        expect(books[index + 1].top - books[index].bottom).toBeGreaterThan(8);
      }
    });
  }
}
