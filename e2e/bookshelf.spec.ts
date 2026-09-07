import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const TEST_EPUB = resolve("e2e/fixtures/test-book.epub");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
});

async function seedShelf(page: Page) {
  await page.goto("/favicon.svg");
  const epub = (await readFile(TEST_EPUB)).toString("base64");
  await page.evaluate(async (data) => {
    const openStore = (name: string, storeName: string) =>
      new Promise<IDBDatabase>((resolveDb, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(storeName);
        request.onsuccess = () => resolveDb(request.result);
        request.onerror = () => reject(request.error);
      });
    const metadata = await openStore("ebook-reader-db", "books");
    const files = await openStore("ebook-reader-book-data", "book-data");
    const cover = new Blob(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#42645d"/><circle cx="100" cy="110" r="55" fill="#dfc785"/></svg>',
      ],
      { type: "image/svg+xml" },
    );
    const records = [
      {
        id: "shelf-local",
        title: "A Field Guide",
        author: "Zora Zenith",
        coverImage: cover,
        hasLocalFile: true,
      },
      {
        id: "shelf-remote",
        title: "Remote reading copy",
        author: "Ada Adams",
        coverImage: null,
        hasLocalFile: false,
        remoteFileUrl: "https://example.com/test.epub",
      },
      {
        id: "shelf-long",
        title: "An unusually long book title about everything a curious reader might want to know",
        author: "An Author With A Very Long Name",
        coverImage: null,
        hasLocalFile: true,
      },
      {
        id: "shelf-deleted",
        title: "Deleted book",
        author: "Deleted Author",
        coverImage: null,
        hasLocalFile: true,
        deletedAt: 1,
      },
    ];
    await new Promise<void>((done, reject) => {
      const transaction = metadata.transaction("books", "readwrite");
      for (const record of records)
        transaction.objectStore("books").put({ ...record, format: "epub" }, record.id);
      transaction.oncomplete = () => done();
      transaction.onerror = () => reject(transaction.error);
    });
    await new Promise<void>((done, reject) => {
      const transaction = files.transaction("book-data", "readwrite");
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0)).buffer;
      transaction.objectStore("book-data").put(bytes, "shelf-local");
      transaction.objectStore("book-data").put(bytes, "shelf-long");
      transaction.oncomplete = () => done();
      transaction.onerror = () => reject(transaction.error);
    });
    metadata.close();
    files.close();
  }, epub);
  await page.goto("/bookshelf");
  await expect(page.getByRole("main", { name: "Bookshelf", exact: true })).toBeVisible();
}

test("shows the library, filters and sorts, and opens a local book", async ({ page }) => {
  await seedShelf(page);
  await expect(page.getByRole("button", { name: "Select A Field Guide by Zora Zenith" })).toHaveCSS(
    "--book-cloth",
    "rgb(66, 100, 93)",
  );
  const books = page.getByRole("list", { name: "Your books" }).getByRole("button");
  await expect(books).toHaveCount(3);
  await expect(books.first()).toHaveAccessibleName("Select Remote reading copy by Ada Adams");
  await page.getByRole("combobox", { name: "Sort bookshelf" }).selectOption("title");
  await expect(books.first()).toHaveAccessibleName("Select A Field Guide by Zora Zenith");
  await page.getByRole("searchbox").fill("ZORA");
  await expect(books).toHaveCount(1);
  await page.getByRole("searchbox").fill("no such book");
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "No books found." })).toHaveText(
    "No books found.",
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
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

test("uses the app theme in light and dark mode without toolbar borders", async ({ page }) => {
  await seedShelf(page);
  const shelf = page.getByRole("main", { name: "Bookshelf", exact: true });
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
  await expect(page.locator(".bookshelf-toolbar")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".bookshelf-toolbar")).toHaveCSS("border-bottom-width", "0px");
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
  await page.goto("/bookshelf");
  await expect(page.getByRole("searchbox", { name: "Search bookshelf" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort bookshelf" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(0);
  await seedShelf(page);
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("button")).toHaveCount(3);
  const shelf = page.getByRole("main", { name: "Bookshelf", exact: true });
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
    return Array.from({ length: 21 }, (_, index) => {
      animation.currentTime = (timing.delay ?? 0) + (duration * index) / 20;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, width: rect.width };
    });
  });
  const start = positions[0];
  const settled = positions.at(-1)!;
  expect(start.top).toBeLessThan(settled.top - 100);
  expect(start.top).toBeGreaterThan(settled.top - 250);
  expect(start.width).toBeCloseTo(settled.width * 0.82, 0);
  expect(Math.max(...positions.map((position) => position.top))).toBeGreaterThan(settled.top + 5);
  const volume = book.locator(".bookshelf-volume");
  const restingBounds = (await volume.boundingBox())!;
  const restingShadow = await volume.evaluate((element) => getComputedStyle(element).boxShadow);
  await book.hover();
  await expect
    .poll(async () => (await volume.boundingBox())!.width)
    .toBeGreaterThan(restingBounds.width + 15);
  await expect(volume).not.toHaveCSS("box-shadow", restingShadow);
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
  await expect(page).toHaveURL(/\/bookshelf$/);
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
  await page.getByRole("searchbox").fill("Ada");
  await expect(page.locator(".bookshelf-stack")).toHaveAttribute("data-selection", "false");
  await page.getByRole("searchbox").fill("");
  await expect(book).toHaveAttribute("aria-pressed", "false");
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
