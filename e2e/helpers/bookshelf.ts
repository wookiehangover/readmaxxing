import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const TEST_EPUB = resolve("e2e/fixtures/test-book.epub");

export async function seedShelf(page: Page, extraBooks = 0) {
  // A remote cover also works in WebKit test contexts that cannot persist blobs.
  await page.route("https://bookshelf.public.blob.vercel-storage.com/cover.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#42645d"/><circle cx="100" cy="110" r="55" fill="#dfc785"/></svg>',
    }),
  );
  await page.goto("/favicon.svg");
  const epub = (await readFile(TEST_EPUB)).toString("base64");
  await page.evaluate(
    async ({ data, extraBooks }) => {
      const openStore = (name: string, storeName: string) =>
        new Promise<IDBDatabase>((resolveDb, reject) => {
          const request = indexedDB.open(name, 1);
          request.onupgradeneeded = () => request.result.createObjectStore(storeName);
          request.onsuccess = () => resolveDb(request.result);
          request.onerror = () => reject(request.error);
        });
      const metadata = await openStore("ebook-reader-db", "books");
      const files = await openStore("ebook-reader-book-data", "book-data");
      const records = [
        {
          id: "shelf-local",
          title: "A Field Guide",
          author: "Zora Zenith",
          coverImage: null,
          remoteCoverUrl: "https://bookshelf.public.blob.vercel-storage.com/cover.svg",
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
          title:
            "An unusually long book title about everything a curious reader might want to know",
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
      for (let index = 0; index < extraBooks; index++) {
        records.push({
          id: `stress-${index}`,
          title: `Stress volume ${String(index).padStart(3, "0")}`,
          author: "Stress Library",
          coverImage: null,
          remoteCoverUrl: `https://bookshelf.public.blob.vercel-storage.com/cover.svg?book=${index}`,
          hasLocalFile: false,
        });
      }
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
    },
    { data: epub, extraBooks },
  );
  await page.goto("/library");
  await expect(page.locator(".bookshelf")).toBeVisible();
  await expect(page.locator('.bookshelf-stack > li[data-active="true"]').first()).toBeVisible();
}
