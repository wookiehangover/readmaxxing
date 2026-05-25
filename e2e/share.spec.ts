import { test, expect, type Browser, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installVirtualAuthenticator,
  registerAndSignIn,
  skipIfAuthNotConfigured,
} from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");
const BOOK_TITLE = "Test Book for E2E";
const BOOK_AUTHOR = "E2E Test Author";

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
    localStorage.setItem(
      "app-settings",
      JSON.stringify({ sidebarCollapsed: true, updatedAt: Date.now() }),
    );
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

  const focusedPill = page
    .getByRole("tablist", { name: "Open books" })
    .getByRole("tab", { name: new RegExp(BOOK_TITLE) });
  const freeformTab = page.locator(".dv-default-tab", { hasText: BOOK_TITLE }).first();
  await expect
    .poll(
      async () =>
        (await focusedPill
          .first()
          .isVisible()
          .catch(() => false)) || (await freeformTab.isVisible().catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);
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
  await page.getByRole("button", { name: "New Library tab" }).click({ timeout: 10_000 });
  await expect(page.locator(".dv-default-tab").filter({ hasText: /^Library$/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Table view" }).click();
  const bookRow = page.getByRole("row").filter({ hasText: BOOK_TITLE }).first();
  await expect(bookRow).toBeVisible({ timeout: 10_000 });
  await bookRow.getByRole("button", { name: "Book actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Share" })).toBeVisible({ timeout: 5_000 });
}

async function createShareLink(page: Page, options?: { maxUses?: number; shareChats?: boolean }) {
  await openBookMenuFromLibrary(page);
  await page.getByRole("menuitem", { name: "Share" }).click();

  const dialog = page.getByRole("dialog", { name: new RegExp(`Share ${BOOK_TITLE}`) });
  await expect(dialog).toBeVisible({ timeout: 10_000 });

  if (options?.maxUses) {
    await dialog.getByLabel("Limit uses").click();
    await dialog.getByLabel("Maximum uses").fill(String(options.maxUses));
  }
  if (options?.shareChats) {
    await dialog.getByLabel("Share chats & notes").click();
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
  const page = await context.newPage();
  await page.goto(shareUrl);
  return { context, page };
}

async function expectShareLandingPage(page: Page) {
  await expect(page.getByRole("heading", { name: BOOK_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`by ${BOOK_AUTHOR}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Library & Read" })).toBeEnabled();
}

async function importSharedBook(page: Page) {
  await page.getByRole("button", { name: "Add to Library & Read" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
  await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 30_000,
  });

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
    await skipIfAuthNotConfigured(request);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installVirtualAuthenticator(context, page);

    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
    await clearBrowserStorage(page);

    await registerAndSignIn(page);
    await uploadTestBook(page);
    await waitForBookSyncedForSharing(page);
    await page.reload();
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
  });

  test("creates a share link and imports it from an unauthenticated context", async ({
    page,
    browser,
  }) => {
    const shareUrl = await createShareLink(page);
    const recipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expectShareLandingPage(recipient.page);
      await importSharedBook(recipient.page);
    } finally {
      await recipient.context.close();
    }
  });

  test("exhausts a use-limited share link after one import", async ({ page, browser }) => {
    const shareUrl = await createShareLink(page, { maxUses: 1 });
    const firstRecipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expectShareLandingPage(firstRecipient.page);
      await importSharedBook(firstRecipient.page);
    } finally {
      await firstRecipient.context.close();
    }

    const secondRecipient = await openShareInNewContext(browser, shareUrl);

    try {
      await expect(secondRecipient.page.getByRole("heading", { name: BOOK_TITLE })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        secondRecipient.page.getByText("This share link has reached its use limit."),
      ).toBeVisible();
      await expect(
        secondRecipient.page.getByRole("button", { name: "Add to Library & Read" }),
      ).toBeDisabled();
    } finally {
      await secondRecipient.context.close();
    }
  });
});
