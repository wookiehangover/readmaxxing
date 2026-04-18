import { beforeEach, describe, expect, it } from "vitest";
import { clear, createStore, set } from "idb-keyval";
import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "~/lib/sync/change-log";
import { runBlobUrlBackfillIfNeeded } from "~/lib/sync/backfill-blob-urls";
import type { BookMeta } from "~/lib/stores/book-store";

const FLAG_KEY = "readmax:blob-url-backfill:v1";

const bookStore = createStore("ebook-reader-db", "books");

beforeEach(async () => {
  localStorage.clear();
  await clear(bookStore);
  const unsynced = await getUnsyncedChanges();
  if (unsynced.length > 0) {
    await markSynced(unsynced.map((c) => c.id));
    await clearSyncedChanges();
  }
  await clearSyncedChanges();
});

describe("runBlobUrlBackfillIfNeeded", () => {
  it("enqueues a change for each book with a remote URL and sets the flag", async () => {
    const withFileUrl: BookMeta = {
      id: "book-file",
      title: "File URL",
      author: "A",
      coverImage: null,
      format: "epub",
      remoteFileUrl: "https://blob.vercel-storage.com/file.epub",
      updatedAt: 1000,
    };
    const withCoverUrl: BookMeta = {
      id: "book-cover",
      title: "Cover URL",
      author: "B",
      coverImage: null,
      format: "epub",
      remoteCoverUrl: "https://blob.vercel-storage.com/cover.jpg",
      updatedAt: 2000,
    };
    const withBothUrls: BookMeta = {
      id: "book-both",
      title: "Both URLs",
      author: "C",
      coverImage: null,
      format: "epub",
      remoteFileUrl: "https://blob.vercel-storage.com/both.epub",
      remoteCoverUrl: "https://blob.vercel-storage.com/both.jpg",
      updatedAt: 3000,
    };
    const noUrls: BookMeta = {
      id: "book-none",
      title: "No URLs",
      author: "D",
      coverImage: null,
      format: "epub",
      updatedAt: 4000,
    };

    await set(withFileUrl.id, withFileUrl, bookStore);
    await set(withCoverUrl.id, withCoverUrl, bookStore);
    await set(withBothUrls.id, withBothUrls, bookStore);
    await set(noUrls.id, noUrls, bookStore);

    await runBlobUrlBackfillIfNeeded();

    const changes = await getUnsyncedChanges();
    const bookChanges = changes.filter((c) => c.entity === "book");
    expect(bookChanges).toHaveLength(3);

    const enqueuedIds = bookChanges.map((c) => c.entityId).sort();
    expect(enqueuedIds).toEqual(["book-both", "book-cover", "book-file"]);

    const fileChange = bookChanges.find((c) => c.entityId === "book-file");
    expect(fileChange).toBeDefined();
    expect(fileChange!.operation).toBe("put");
    expect((fileChange!.data as BookMeta).remoteFileUrl).toBe(
      "https://blob.vercel-storage.com/file.epub",
    );
    expect(fileChange!.timestamp).toBe(1000);

    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  });

  it("is a no-op when the flag is already set", async () => {
    localStorage.setItem(FLAG_KEY, "1");

    const book: BookMeta = {
      id: "book-x",
      title: "X",
      author: "X",
      coverImage: null,
      format: "epub",
      remoteFileUrl: "https://blob.vercel-storage.com/x.epub",
      updatedAt: 5000,
    };
    await set(book.id, book, bookStore);

    await runBlobUrlBackfillIfNeeded();

    const changes = await getUnsyncedChanges();
    expect(changes.filter((c) => c.entity === "book")).toHaveLength(0);
  });

  it("skips soft-deleted books", async () => {
    const deleted: BookMeta = {
      id: "book-deleted",
      title: "Deleted",
      author: "D",
      coverImage: null,
      format: "epub",
      remoteFileUrl: "https://blob.vercel-storage.com/del.epub",
      updatedAt: 6000,
      deletedAt: 7000,
    };
    await set(deleted.id, deleted, bookStore);

    await runBlobUrlBackfillIfNeeded();

    const changes = await getUnsyncedChanges();
    expect(changes.filter((c) => c.entity === "book")).toHaveLength(0);
    expect(localStorage.getItem(FLAG_KEY)).toBe("1");
  });

  it("is idempotent — running twice produces only one batch of changes", async () => {
    const book: BookMeta = {
      id: "book-once",
      title: "Once",
      author: "O",
      coverImage: null,
      format: "epub",
      remoteFileUrl: "https://blob.vercel-storage.com/once.epub",
      updatedAt: 8000,
    };
    await set(book.id, book, bookStore);

    await runBlobUrlBackfillIfNeeded();
    await runBlobUrlBackfillIfNeeded();

    const changes = await getUnsyncedChanges();
    expect(changes.filter((c) => c.entity === "book")).toHaveLength(1);
  });
});
