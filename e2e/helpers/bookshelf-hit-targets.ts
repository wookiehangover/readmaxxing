import { expect, type Locator, type Page } from "@playwright/test";

export async function settleBook(book: Locator) {
  await book.locator("..").evaluate(async (row) => {
    await Promise.allSettled(
      row.getAnimations({ subtree: true }).map((animation) => animation.finished),
    );
  });
}

export async function tapBookGutter(page: Page, book: Locator) {
  await settleBook(book);
  const point = await book.locator("..").evaluate((row) => {
    const bounds = row.getBoundingClientRect();
    for (
      let top = Math.max(bounds.top, 0) + 32;
      top < Math.min(bounds.bottom, innerHeight) - 24;
      top += 16
    ) {
      for (
        let left = Math.min(bounds.right, innerWidth) - 32;
        left > Math.max(bounds.left, 0) + 24;
        left -= 16
      ) {
        let uncovered = true;
        for (let offsetY = -24; offsetY <= 24; offsetY += 8) {
          for (let offsetX = -24; offsetX <= 24; offsetX += 8) {
            if (document.elementFromPoint(left + offsetX, top + offsetY) !== row) uncovered = false;
          }
        }
        if (uncovered) return { x: left, y: top };
      }
    }
    return null;
  });
  expect(
    point,
    "selected row has an uncovered gutter with room for a touch contact",
  ).not.toBeNull();
  await page.touchscreen.tap(point!.x, point!.y);
}

export async function projectedCoverCenter(book: Locator) {
  await settleBook(book);
  return book.locator(".bookshelf-cover").evaluate((cover) => {
    const marker = document.createElement("span");
    marker.style.cssText =
      "position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none";
    cover.append(marker);
    const bounds = marker.getBoundingClientRect();
    marker.remove();
    return {
      x: bounds.x,
      y: bounds.y,
      hitsCover: cover.contains(document.elementFromPoint(bounds.x, bounds.y)),
    };
  });
}
