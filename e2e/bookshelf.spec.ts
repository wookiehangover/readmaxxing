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
  await expect(page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" })).toHaveCSS(
    "--book-cloth",
    "rgb(66, 100, 93)",
  );
  const books = page.getByRole("list", { name: "Your books" }).getByRole("link");
  await expect(books).toHaveCount(3);
  await expect(books.first()).toHaveAccessibleName("Read Remote reading copy by Ada Adams");
  await page.getByRole("combobox", { name: "Sort bookshelf" }).selectOption("title");
  await expect(books.first()).toHaveAccessibleName("Read A Field Guide by Zora Zenith");
  await page.getByRole("searchbox").fill("ZORA");
  await expect(books).toHaveCount(1);
  await page.getByRole("searchbox").fill("no such book");
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "No books found." })).toHaveText(
    "No books found.",
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).first().click();
  await expect(books).toHaveCount(3);
  await page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/books\/shelf-local$/);
  await expect(page.getByTestId("reading-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page", exact: true }).first()).toBeVisible();
  await page.goto("/library");
  await page.getByRole("button", { name: "Stack view" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("link")).toHaveCount(3);
});

test("persists stack layout and shares filtering across all three library views", async ({
  page,
}) => {
  await seedShelf(page);
  await page.goto("/library");
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
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("link")).toHaveCount(1);
  await page.getByRole("button", { name: "Grid view" }).click();
  await expect(page.getByRole("button", { name: "Open A Field Guide" })).toBeVisible();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search books" })).toHaveValue("Zora");
  await page.getByRole("button", { name: "Stack view" }).click();
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
  await page.getByRole("link", { name: "Read Remote reading copy by Ada Adams" }).click();
  expect((await download).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Next page", exact: true }).first()).toBeVisible();
});

test("fits long titles on mobile and supports an empty library", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/bookshelf");
  await expect(page.getByRole("searchbox", { name: "Search bookshelf" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort bookshelf" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("link")).toHaveCount(0);
  await seedShelf(page);
  await expect(page.getByRole("list", { name: "Your books" }).getByRole("link")).toHaveCount(3);
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
  const book = page.getByRole("link", { name: "Read A Field Guide by Zora Zenith" });
  const positions = await book.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    const timing = animation.effect!.getComputedTiming();
    const duration = Number(timing.duration);
    return [0, 300, duration].map((time) => {
      animation.currentTime = (timing.delay ?? 0) + time;
      return element.getBoundingClientRect().top;
    });
  });
  const [start, overshoot, settled] = positions;
  expect(start).toBeLessThan(settled - 100);
  expect(overshoot).toBeGreaterThan(settled + 5);
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
