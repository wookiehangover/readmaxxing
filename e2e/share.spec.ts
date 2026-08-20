import { test, expect, type Browser, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installVirtualAuthenticator,
  registerAndSignIn,
  skipIfAuthNotConfigured,
  waitForAppHydration,
} from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");
const BOOK_TITLE = "Test Book for E2E";
const BOOK_AUTHOR = "Test Author";

interface StoredBook {
  id: string;
  title?: string;
  author?: string;
  remoteFileUrl?: string;
}

async function clearBrowserStorage(page: Page) {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
  });
}

async function readBooksFromIdb(page: Page): Promise<StoredBook[]> {
  return await page.evaluate(
    () =>
      new Promise<StoredBook[]>((resolve) => {
        const open = indexedDB.open("ebook-reader-db");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("books")) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction("books", "readonly");
          const req = tx.objectStore("books").getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result as StoredBook[]);
          };
          req.onerror = () => {
            db.close();
            resolve([]);
          };
        };
        open.onerror = () => resolve([]);
      }),
  );
}

async function countUnsyncedChanges(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("ebook-reader-changelog");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("changes")) {
            db.close();
            resolve(0);
            return;
          }
          const tx = db.transaction("changes", "readonly");
          const req = tx.objectStore("changes").getAll();
          req.onsuccess = () => {
            db.close();
            resolve(
              req.result.filter((entry: { synced?: boolean }) => entry.synced === false).length,
            );
          };
          req.onerror = () => {
            db.close();
            resolve(0);
          };
        };
        open.onerror = () => resolve(0);
      }),
  );
}

async function uploadTestBook(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_EPUB);

  const readingShell = page.getByTestId("reading-shell");
  const libraryBook = page.getByRole("button", { name: "Open Test Book for E2E" });
  await expect
    .poll(
      async () =>
        (await readingShell.isVisible().catch(() => false)) ||
        (await libraryBook.isVisible().catch(() => false)),
      { timeout: 20_000 },
    )
    .toBe(true);

  if (!(await readingShell.isVisible().catch(() => false))) {
    await libraryBook.click({ force: true, timeout: 5_000 }).catch(() => {});
    await expect(readingShell).toBeVisible({ timeout: 20_000 });
  }
}

async function waitForBookSyncedForSharing(page: Page) {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent("sync:push-needed")));
        const books = await readBooksFromIdb(page);
        const book = books.find((entry) => entry.title === BOOK_TITLE);
        const unsyncedChanges = await countUnsyncedChanges(page);
        return Boolean(book?.remoteFileUrl) && unsyncedChanges === 0;
      },
      { timeout: 120_000, intervals: [500, 1000, 2000, 5000] },
    )
    .toBe(true);
}

async function openBookMenuFromLibrary(page: Page) {
  await page.goto("/library");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "Table view" }).click();
  const bookRow = page.getByRole("row").filter({ hasText: BOOK_TITLE }).first();
  await expect(bookRow).toBeVisible({ timeout: 10_000 });
  const shareMenuItem = page.getByRole("menuitem", { name: "Share" });

  await expect
    .poll(
      async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(200);
        await bookRow.getByRole("button", { name: "Book actions" }).click();
        await shareMenuItem.waitFor({ state: "visible", timeout: 1_000 }).catch(() => {});
        return await shareMenuItem.isVisible().catch(() => false);
      },
      { timeout: 15_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
}

async function createShareLink(page: Page, options?: { maxUses?: number; shareChats?: boolean }) {
  await openBookMenuFromLibrary(page);
  await page.getByRole("menuitem", { name: "Share" }).click();

  const dialog = page.getByRole("dialog", { name: new RegExp(`Share ${BOOK_TITLE}`) });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  if (options?.maxUses) {
    await dialog.getByRole("switch", { name: "Limit uses" }).click();
    await dialog.getByLabel("Maximum uses").fill(String(options.maxUses));
  }
  if (options?.shareChats) {
    await dialog.getByRole("switch", { name: "Share chats & notes" }).click();
  }

  await dialog.getByRole("button", { name: "Create Link" }).click();
  const shareUrlInput = dialog.getByLabel("Share URL");
  await expect(shareUrlInput).toHaveValue(/^https?:\/\//, { timeout: 30_000 });

  const shareUrl = await shareUrlInput.inputValue();
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(async () => await page.evaluate(() => navigator.clipboard.readText()))
    .toBe(shareUrl);
  return shareUrl;
}

async function openShareInNewContext(browser: Browser, shareUrl: string) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  const page = await context.newPage();
  await page.goto(shareUrl);
  return { context, page };
}

async function expectShareReadingShell(page: Page) {
  const banner = page.getByTestId("share-banner");
  await expect(banner).toContainText(BOOK_TITLE, { timeout: 15_000 });
  await expect(banner).toContainText(BOOK_AUTHOR);
  await expect(page.getByTestId("share-reading-shell")).toBeVisible();
  await expect(page.getByRole("region", { name: "Book surface" })).toBeVisible();

  const discussRail = page.getByRole("complementary", { name: "Discuss" });
  await expect(discussRail).toBeVisible();
  await expect(discussRail.getByRole("tab", { name: "Discuss" })).toBeVisible();
  await expect(discussRail.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add to Library" })).toBeEnabled();
}

async function importSharedBook(page: Page) {
  await Promise.all([
    page.waitForURL((url) => /^\/books\/[^/]+$/.test(url.pathname), {
      timeout: 30_000,
      waitUntil: "commit",
    }),
    page.getByRole("button", { name: "Add to Library" }).click(),
  ]);
  await waitForAppHydration(page);

  await expect
    .poll(
      async () => {
        const books = await readBooksFromIdb(page);
        return books.some((book) => book.title === BOOK_TITLE);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe("Share", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page, context, request }) => {
    // Skip share tests in CI - they require Vercel Blob storage for book sync
    test.skip(!!process.env.SKIP_SHARE_TESTS, "Share tests skipped (require Vercel Blob storage)");

    await skipIfAuthNotConfigured(request);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installVirtualAuthenticator(context, page);
    await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));

    await page.goto("/favicon.svg", { waitUntil: "domcontentloaded" });
    await clearBrowserStorage(page);

    await registerAndSignIn(page);
    await uploadTestBook(page);
    await waitForBookSyncedForSharing(page);
    await page.reload();
    await waitForAppHydration(page);
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/auth/session");
          if (!res.ok()) return null;
          const body = (await res.json()) as { user?: { id?: string } | null };
          return body.user?.id ?? null;
        },
        { timeout: 15_000, intervals: [200, 300, 500, 750, 1000] },
      )
      .not.toBeNull();
  });

  test("creates a share link and imports it from an unauthenticated context", async ({
    page,
    browser,
  }) => {
    const shareUrl = await createShareLink(page);
    const recipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expectShareReadingShell(recipient.page);
      await importSharedBook(recipient.page);
    } finally {
      await recipient.context.close();
    }
  });

  test("exhausts a use-limited share link after one import", async ({ page, browser }) => {
    const shareUrl = await createShareLink(page, { maxUses: 1 });
    const firstRecipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expectShareReadingShell(firstRecipient.page);
      await importSharedBook(firstRecipient.page);
    } finally {
      await firstRecipient.context.close();
    }

    const secondRecipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expect(
        secondRecipient.page.getByText("This share link has reached its use limit."),
      ).toBeVisible({ timeout: 15_000 });
      await expect(secondRecipient.page.getByTestId("share-reading-shell")).toHaveCount(0);
      await expect(
        secondRecipient.page.getByRole("button", { name: "Add to Library" }),
      ).toHaveCount(0);
    } finally {
      await secondRecipient.context.close();
    }
  });
});
