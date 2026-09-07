import { test, expect } from "@playwright/test";
import { seedShelf, TEST_EPUB } from "./helpers/bookshelf";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
});

test("shows the library, filters and sorts, and opens a local book", async ({ page }) => {
  await seedShelf(page);
  await expect(page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" })).toHaveCSS(
    "--book-cloth",
    "rgb(66, 100, 93)",
  );
  const books = page.getByRole("list", { name: "Your books" }).getByRole("button");
  await expect(books).toHaveCount(3);
  await expect(books.first()).toHaveAccessibleName("Select Remote reading copy by Ada Adams");
  await page.getByRole("button", { name: "Sort library by Author" }).click();
  await page.getByRole("menuitemradio", { name: "Title", exact: true }).click();
  await expect(books.first()).toHaveAccessibleName("Select A Field Guide by Zora Zenith");
  await page.getByRole("textbox", { name: "Search books" }).fill("ZORA");
  await expect(books).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search books" }).fill("no such book");
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByText("No matching books", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search books" }).fill("");
  await expect(books).toHaveCount(3);
  await page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" }).click();
  await expect(page).toHaveURL(/\/books\/shelf-local$/);
  await expect(page.getByTestId("reading-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page", exact: true }).first()).toBeVisible();
  await page.goto("/library");
  await page.getByRole("button", { name: "Stack view" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(3);
});

test("persists stack layout and shares filtering across all three library views", async ({
  page,
}) => {
  await seedShelf(page);
  await page.goto("/library");
  await expect(page.getByRole("button", { name: "Stack view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Grid view" }).click();
  await page.getByRole("button", { name: "Stack view" }).click();
  await expect(page.getByRole("button", { name: "Stack view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Stack view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("textbox", { name: "Search books" }).fill("Zora");
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("button", { name: "Open A Field Guide" })).toBeVisible();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search books" })).toHaveValue("Zora");
  await page.getByRole("button", { name: "Stack view" }).click();
  await page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" }).click();
  await page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" }).click();
  await expect(page).toHaveURL(/\/books\/shelf-local$/);
  await expect(page.getByTestId("reading-shell")).toBeVisible();
});

test("uses the app theme in light and dark mode", async ({ page }) => {
  await seedShelf(page);
  const shelf = page.locator(".bookshelf");
  const backgrounds: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
      .toBe(colorScheme === "dark");
    const colors = await shelf.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      appBackground: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(element).color,
      appForeground: getComputedStyle(document.body).color,
    }));
    expect(colors.background).toBe(colors.appBackground);
    expect(colors.foreground).toBe(colors.appForeground);
    backgrounds.push(colors.background);
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});

test("downloads a remote book through the existing reader", async ({ page }) => {
  await seedShelf(page);
  await page.route("**/api/sync/files/download?bookId=shelf-remote&type=file", (route) =>
    route.fulfill({ path: TEST_EPUB, contentType: "application/epub+zip" }),
  );
  const download = page.waitForResponse((response) =>
    response.url().includes("bookId=shelf-remote&type=file"),
  );
  await page.getByRole("button", { name: "Select Remote reading copy by Ada Adams" }).click();
  await page.getByRole("link", { name: "Read Remote reading copy by Ada Adams" }).click();
  expect((await download).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Next page", exact: true }).first()).toBeVisible();
});

test("fits long titles on mobile and supports an empty library", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  await expect(page.getByRole("textbox", { name: "Search books" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sort library by Author" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(0);
  await seedShelf(page);
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(3);
  const shelf = page.locator(".bookshelf");
  expect(await shelf.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(
    page
      .getByText(
        "An unusually long book title about everything a curious reader might want to know",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
});

test("books spring in from above, pull forward on hover, and respect reduced motion", async ({
  page,
}) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const positions = await book.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    const timing = animation.effect!.getComputedTiming();
    const duration = Number(timing.duration);
    const samples = Array.from({ length: 21 }, (_, index) => {
      animation.currentTime = (timing.delay ?? 0) + (duration * index) / 20;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, width: rect.width };
    });
    animation.finish();
    return samples;
  });
  const start = positions[0];
  const settled = positions.at(-1)!;
  expect(start.top).toBeLessThan(settled.top - 100);
  expect(start.top).toBeGreaterThan(settled.top - 250);
  expect(start.width).toBeCloseTo(settled.width * 0.82, 0);
  expect(Math.max(...positions.map((position) => position.top))).toBeGreaterThan(settled.top + 5);
  const volume = book.locator(".bookshelf-volume");
  const restingBounds = (await volume.boundingBox())!;
  await expect
    .poll(() => volume.evaluate((element) => getComputedStyle(element, "::after").opacity))
    .toBe("0");
  await book.hover();
  await expect
    .poll(async () => (await volume.boundingBox())!.width)
    .toBeGreaterThan(restingBounds.width + 15);
  await expect
    .poll(() => volume.evaluate((element) => getComputedStyle(element, "::after").opacity))
    .toBe("1");
  await expect
    .poll(() =>
      book
        .locator(".bookshelf-spine")
        .evaluate((element) => getComputedStyle(element, "::before").opacity),
    )
    .toBe("0.18");
  await expect(page.locator(".bookshelf-preview")).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => (await volume.boundingBox())!.width)
    .toBeCloseTo(restingBounds.width, 1);
  await book.focus();
  await expect
    .poll(async () => (await volume.boundingBox())!.width)
    .toBeGreaterThan(restingBounds.width + 15);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(book).toHaveCSS("animation-name", "none");
  await expect(volume).toHaveCSS("transform", "none");
  await expect(volume).toHaveCSS("transition-duration", "0s");
});

test("large stacks only animate nearby rows and can select books after scrolling", async ({
  page,
}) => {
  await seedShelf(page);
  await page.evaluate(async () => {
    const request = indexedDB.open("ebook-reader-db", 1);
    await new Promise<void>((resolveDb, reject) => {
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("books", "readwrite");
        for (let index = 0; index < 100; index++) {
          const id = `large-shelf-${index}`;
          transaction.objectStore("books").put(
            {
              id,
              title: `Volume ${String(index).padStart(3, "0")}`,
              author: "Large Library",
              format: "epub",
              coverImage: null,
              hasLocalFile: true,
            },
            id,
          );
        }
        transaction.oncomplete = () => {
          db.close();
          resolveDb();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto("/library");
  const rows = page.locator(".bookshelf-stack > li");
  await expect(rows).toHaveCount(103);
  await page.locator(".bookshelf-book").evaluateAll((books) => {
    books.forEach((book) => book.getAnimations().forEach((animation) => animation.finish()));
  });
  const first = page.getByRole("button", { name: "Select Volume 000 by Large Library" });
  const last = page.getByRole("button", { name: "Select Volume 099 by Large Library" });
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  const receding = page.locator('.bookshelf-stack > li[data-receding="true"]');
  expect(await receding.count()).toBeGreaterThan(1);
  expect(await receding.count()).toBeLessThan(12);
  await expect(last.locator("..")).toHaveCSS("transform", "none");
  await page.keyboard.press("Escape");
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(first.locator("..")).toHaveCSS("transform", "none");
  expect(await receding.count()).toBeLessThan(12);
  await page.locator(".bookshelf").evaluate((shelf) => {
    shelf.scrollTop = 0;
  });
  await expect(last).toHaveAttribute("aria-pressed", "false");
  await expect(receding).toHaveCount(0);
});

test("selection turns the cover left, recedes the stack, and reverses with Escape or a stack click", async ({
  page,
}) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const other = page.getByRole("button", { name: "Select Remote reading copy by Ada Adams" });
  await expect(book).toBeVisible();
  await book.evaluate((e) => e.getAnimations().forEach((a) => a.finish()));
  await other.evaluate((e) => e.getAnimations().forEach((a) => a.finish()));
  const original = (await other.boundingBox())!;
  await book.click();
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/library$/);
  const cover = book.locator(".bookshelf-top");
  await expect
    .poll(async () => {
      const b = (await cover.boundingBox())!;
      return b.height / b.width;
    })
    .toBeGreaterThan(1.35);
  await expect.poll(async () => (await other.boundingBox())!.x).toBeGreaterThan(original.x + 100);
  await expect
    .poll(async () => (await other.boundingBox())!.width)
    .toBeLessThan(original.width * 0.9);
  await expect(page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" })).toBeVisible();
  // A queued scroll event from bringing the book into view must not dismiss it.
  await page.locator(".bookshelf").dispatchEvent("scroll");
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect(book).toBeFocused();
  await expect.poll(async () => (await other.boundingBox())!.x).toBeCloseTo(original.x, 0);
  await book.click();
  await other.click();
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect(other).toHaveAttribute("aria-pressed", "false");
  await book.click();
  await page.getByRole("textbox", { name: "Search books" }).fill("Ada");
  await expect(page.locator(".bookshelf-stack")).toHaveAttribute("data-selection", "false");
  await page.getByRole("textbox", { name: "Search books" }).fill("");
  await expect(book).toHaveAttribute("aria-pressed", "false");
});

test("pointer dismissal does not add a focus ring, while Escape restores keyboard focus", async ({
  page,
}) => {
  await seedShelf(page);
  await page.goto("/library");
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const other = page.getByRole("button", { name: "Select Remote reading copy by Ada Adams" });
  // Safari leaves the search field focused when a book is clicked.
  await page.getByRole("textbox").focus();
  await book.click();
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await other.click();
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect(book).not.toBeFocused();
  await expect(book).toHaveCSS("outline-style", "none");

  await book.focus();
  await page.keyboard.press("Enter");
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" }).focus();
  await page.keyboard.press("Escape");
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect(book).toBeFocused();
  await expect(book).toHaveCSS("outline-style", "none");
  await expect(book.locator(".bookshelf-book-title")).toHaveCSS("text-decoration-line", "none");
  await expect(book.locator(".bookshelf-top")).toHaveCSS("outline-style", "none");
});

test("mobile selection stays inline and reserves room for the upright cover", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select Remote reading copy by Ada Adams" });
  const next = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  const before = (await next.boundingBox())!;
  await book.click();
  await expect(book).toHaveAttribute("aria-pressed", "true");
  const after = (await next.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.y).toBeGreaterThan(before.y + 150);
  const cover = (await book.locator(".bookshelf-top").boundingBox())!;
  expect(cover.height).toBeGreaterThan(cover.width * 1.35);
  expect(cover.x).toBeGreaterThan(0);
  expect(cover.x + cover.width).toBeLessThan(390);
  expect(cover.y + cover.height).toBeLessThan(after.y);
  // Hit the visible projected cover, rather than the untransformed CSS face.
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await expect(book).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await next.boundingBox())!.y).toBeCloseTo(before.y, 0);
});

test("selected book actions stay open independently and navigate to the notebook", async ({
  page,
}) => {
  await seedShelf(page);
  const book = page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" });
  await book.click();
  const menu = page.getByRole("button", { name: "More actions for A Field Guide" });
  await menu.click();
  await expect(page.getByRole("menuitem", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(book).toHaveAttribute("aria-pressed", "true");
  await menu.click();
  await page.getByRole("menuitem", { name: "Open notebook" }).click();
  await expect(page).toHaveURL(/\/books\/shelf-local$/);
  await expect(page.getByTestId("reading-shell")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("layout and sort controls are muted in both themes and brighten on hover", async ({
  page,
}) => {
  await seedShelf(page);
  await page.goto("/library");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => page.locator("html").evaluate((e) => e.classList.contains("dark")))
      .toBe(colorScheme === "dark");
    for (const control of [
      page.getByRole("button", { name: "Stack view" }),
      page.getByRole("button", { name: "Sort library by Author" }),
    ]) {
      await page.mouse.move(0, 0);
      await expect
        .poll(() =>
          control.evaluate(
            (e) => getComputedStyle(e).color !== getComputedStyle(document.body).color,
          ),
        )
        .toBe(true);
      await control.hover();
      await expect
        .poll(() =>
          control.evaluate(
            (e) => getComputedStyle(e).color === getComputedStyle(document.body).color,
          ),
        )
        .toBe(true);
    }
  }
});
