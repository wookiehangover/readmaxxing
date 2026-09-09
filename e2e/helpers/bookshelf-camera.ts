import { expect, type Locator } from "@playwright/test";

export async function settleBookshelfCamera(book: Locator) {
  await expect
    .poll(async () =>
      book.evaluate(async (element) => {
        const shelf = element.closest<HTMLElement>(".bookshelf");
        if (!shelf) return false;
        const read = () =>
          [
            shelf.scrollTop,
            shelf.clientWidth,
            shelf.clientHeight,
            ...Array.from(
              shelf.querySelectorAll<HTMLElement>('.bookshelf-scene[data-active="true"]'),
              (scene) => scene.style.getPropertyValue("--shelf-camera-y"),
            ),
          ].join("|");
        const state = read();
        for (let frame = 0; frame < 3; frame++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (read() !== state) return false;
        }
        return element.querySelector('.bookshelf-scene[data-active="true"]') !== null;
      }),
    )
    .toBe(true);
}
