import { beforeEach, describe, expect, it } from "vitest";
import { createStore } from "idb-keyval";
import { makeBookmarkService } from "~/lib/stores/bookmark-store";
import type { Bookmark } from "~/lib/stores/bookmark-store";
import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "~/lib/sync/change-log";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: overrides.id ?? "bookmark-1",
    bookId: overrides.bookId ?? "book-1",
    cfi: overrides.cfi ?? "epubcfi(/6/4!/4/2)",
    label: overrides.label,
    pageNumber: overrides.pageNumber,
    displayPage: overrides.displayPage,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt,
    deletedAt: overrides.deletedAt,
  };
}

let testCounter = 0;

function makeTestService() {
  const suffix = `bookmark-test-${++testCounter}-${Date.now()}`;
  const bookmarkStore = createStore(`bookmark-db-${suffix}`, "bookmarks");

  return makeBookmarkService({ bookmarkStore });
}

async function clearChangeLog() {
  const changes = await getUnsyncedChanges();
  if (changes.length === 0) return;
  await markSynced(changes.map((change) => change.id));
  await clearSyncedChanges();
}

describe("BookmarkService", () => {
  beforeEach(async () => {
    await clearChangeLog();
  });

  it("saves and retrieves non-deleted bookmarks for a book", async () => {
    const service = makeTestService();

    await service.saveBookmark(makeBookmark({ displayPage: 12 }));
    await service.saveBookmark(makeBookmark({ id: "bookmark-2", bookId: "book-2" }));

    const bookmarks = await service.getBookmarksByBook("book-1");
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].id).toBe("bookmark-1");
    expect(bookmarks[0].displayPage).toBe(12);
  });

  it("soft-deletes bookmarks and records the delete change", async () => {
    const service = makeTestService();

    await service.saveBookmark(makeBookmark());
    await clearChangeLog();
    await service.deleteBookmark("bookmark-1");

    const bookmarks = await service.getBookmarksByBook("book-1");
    expect(bookmarks).toEqual([]);

    const changes = await getUnsyncedChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].entity).toBe("bookmark");
    expect(changes[0].operation).toBe("delete");
  });

  it("checks whether a book CFI is already bookmarked", async () => {
    const service = makeTestService();

    await service.saveBookmark(makeBookmark());

    await expect(service.isBookmarked("book-1", "epubcfi(/6/4!/4/2)")).resolves.toBe(true);
    await expect(service.isBookmarked("book-1", "epubcfi(/6/8!/4/2)")).resolves.toBe(false);
  });
});
