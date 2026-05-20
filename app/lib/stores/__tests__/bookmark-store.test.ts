import { beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { createStore } from "idb-keyval";
import { BookmarkService, makeBookmarkService } from "~/lib/stores/bookmark-store";
import type { Bookmark } from "~/lib/stores/bookmark-store";
import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "~/lib/sync/change-log";

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: overrides.id ?? "bookmark-1",
    bookId: overrides.bookId ?? "book-1",
    cfi: overrides.cfi ?? "epubcfi(/6/4!/4/2)",
    label: overrides.label,
    pageNumber: overrides.pageNumber,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt,
    deletedAt: overrides.deletedAt,
  };
}

let testCounter = 0;

function makeTestLayer() {
  const suffix = `bookmark-test-${++testCounter}-${Date.now()}`;
  const bookmarkStore = createStore(`bookmark-db-${suffix}`, "bookmarks");

  return Layer.succeed(BookmarkService, makeBookmarkService({ bookmarkStore }));
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
    const layer = makeTestLayer();
    const run = <A, E>(effect: Effect.Effect<A, E, BookmarkService>) =>
      Effect.runPromise(Effect.provide(effect, layer));

    await run(
      BookmarkService.pipe(Effect.andThen((service) => service.saveBookmark(makeBookmark()))),
    );
    await run(
      BookmarkService.pipe(
        Effect.andThen((service) =>
          service.saveBookmark(makeBookmark({ id: "bookmark-2", bookId: "book-2" })),
        ),
      ),
    );

    const bookmarks = await run(
      BookmarkService.pipe(Effect.andThen((service) => service.getBookmarksByBook("book-1"))),
    );
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].id).toBe("bookmark-1");
  });

  it("soft-deletes bookmarks and records the delete change", async () => {
    const layer = makeTestLayer();
    const run = <A, E>(effect: Effect.Effect<A, E, BookmarkService>) =>
      Effect.runPromise(Effect.provide(effect, layer));

    await run(
      BookmarkService.pipe(Effect.andThen((service) => service.saveBookmark(makeBookmark()))),
    );
    await clearChangeLog();
    await run(
      BookmarkService.pipe(Effect.andThen((service) => service.deleteBookmark("bookmark-1"))),
    );

    const bookmarks = await run(
      BookmarkService.pipe(Effect.andThen((service) => service.getBookmarksByBook("book-1"))),
    );
    expect(bookmarks).toEqual([]);

    const changes = await getUnsyncedChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].entity).toBe("bookmark");
    expect(changes[0].operation).toBe("delete");
  });

  it("checks whether a book CFI is already bookmarked", async () => {
    const layer = makeTestLayer();
    const run = <A, E>(effect: Effect.Effect<A, E, BookmarkService>) =>
      Effect.runPromise(Effect.provide(effect, layer));

    await run(
      BookmarkService.pipe(Effect.andThen((service) => service.saveBookmark(makeBookmark()))),
    );

    await expect(
      run(
        BookmarkService.pipe(
          Effect.andThen((service) => service.isBookmarked("book-1", "epubcfi(/6/4!/4/2)")),
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      run(
        BookmarkService.pipe(
          Effect.andThen((service) => service.isBookmarked("book-1", "epubcfi(/6/8!/4/2)")),
        ),
      ),
    ).resolves.toBe(false);
  });
});
