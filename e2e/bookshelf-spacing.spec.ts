import { test, expect, type Locator } from "@playwright/test";
import { seedShelf } from "./helpers/bookshelf";

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
        inViewport: spine.bottom > shelf.top && spine.top < shelf.bottom,
      };
    });
  });
}

for (const [width, height] of [
  [390, 500],
  [390, 844],
  [1280, 844],
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

      for (const fraction of [0.2, 0.5, 0.8, 0.95]) {
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
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        await stack.evaluate(async (element) => {
          await Promise.allSettled(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished),
          );
        });
        const books = await projectedBooks(stack);
        for (const [index, current] of books.entries()) {
          if (!current.inViewport) continue;
          expect(current.faces).toHaveLength(6);
          expect(current.spineTop - current.top).toBeLessThanOrEqual(18.1);
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
            expect(gap).toBeLessThanOrEqual(37);
          }
        }
        const target = books.find((candidate) => candidate.id === "stress-30")!;
        if (fraction <= 0.5) {
          expect(target.faces.find((face) => face.name === "bookshelf-top")!.facingCamera).toBe(
            false,
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
