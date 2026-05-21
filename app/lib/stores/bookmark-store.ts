import { get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import { BookmarkError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { isWellFormedEntry } from "~/lib/sync/idb-entry";
import { getBookmarkStore } from "~/lib/sync/stores";

export const BookmarkSchema = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  cfi: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  pageNumber: Schema.optional(Schema.Number),
  displayPage: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.optional(Schema.Number),
  deletedAt: Schema.optional(Schema.Number),
});

export type Bookmark = typeof BookmarkSchema.Type;

const decodeBookmark = Schema.decodeUnknownSync(BookmarkSchema);

export class BookmarkService extends Context.Tag("BookmarkService")<
  BookmarkService,
  {
    readonly getBookmarksByBook: (
      bookId: string,
    ) => Effect.Effect<Bookmark[], BookmarkError | DecodeError>;
    readonly saveBookmark: (bookmark: Bookmark) => Effect.Effect<void, BookmarkError>;
    readonly deleteBookmark: (id: string) => Effect.Effect<void, BookmarkError | DecodeError>;
    readonly isBookmarked: (
      bookId: string,
      cfi: string,
    ) => Effect.Effect<boolean, BookmarkError | DecodeError>;
  }
>() {}

export interface BookmarkServiceStores {
  readonly bookmarkStore: UseStore;
}

function isActiveBookmark(bookmark: Bookmark): boolean {
  return bookmark.deletedAt === undefined;
}

export function makeBookmarkService(stores: BookmarkServiceStores): BookmarkService["Type"] {
  const { bookmarkStore } = stores;
  return {
    getBookmarksByBook: (bookId) =>
      Effect.gen(function* () {
        const allEntries = yield* Effect.tryPromise({
          try: () => entries<string, unknown>(bookmarkStore),
          catch: (cause) => new BookmarkError({ operation: "getBookmarksByBook", cause }),
        });
        return yield* Effect.try({
          try: () => {
            const bookmarks: Bookmark[] = [];
            for (const entry of allEntries) {
              if (!isWellFormedEntry(entry)) continue;
              const [key, raw] = entry;
              if (raw == null || typeof raw !== "object") continue;
              try {
                const bookmark = decodeBookmark(raw);
                if (bookmark.bookId === bookId && isActiveBookmark(bookmark)) {
                  bookmarks.push(bookmark);
                }
              } catch (err) {
                console.warn(
                  `[bookmark-store] Skipping malformed bookmark record (key=${String(key)})`,
                  err,
                );
              }
            }
            return bookmarks;
          },
          catch: (cause) => new DecodeError({ operation: "getBookmarksByBook", cause }),
        });
      }),

    saveBookmark: (bookmark) =>
      Effect.tryPromise({
        try: async () => {
          const stamped = { ...bookmark, updatedAt: bookmark.updatedAt ?? Date.now() };
          await set(bookmark.id, stamped, bookmarkStore);
          recordChange({
            entity: "bookmark",
            entityId: bookmark.id,
            operation: "put",
            data: stamped,
            timestamp: stamped.updatedAt,
          }).catch(console.error);
        },
        catch: (cause) =>
          new BookmarkError({ operation: "saveBookmark", bookmarkId: bookmark.id, cause }),
      }),

    deleteBookmark: (id) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(id, bookmarkStore),
          catch: (cause) =>
            new BookmarkError({ operation: "deleteBookmark.read", bookmarkId: id, cause }),
        });
        if (!raw) return;
        const existing = yield* Effect.try({
          try: () => decodeBookmark(raw),
          catch: (cause) => new DecodeError({ operation: "deleteBookmark.decode", cause }),
        });
        const now = Date.now();
        const tombstone = { ...existing, deletedAt: now, updatedAt: now };
        yield* Effect.tryPromise({
          try: () => set(id, tombstone, bookmarkStore),
          catch: (cause) =>
            new BookmarkError({ operation: "deleteBookmark.write", bookmarkId: id, cause }),
        });
        recordChange({
          entity: "bookmark",
          entityId: id,
          operation: "delete",
          data: tombstone,
          timestamp: now,
        }).catch(console.error);
      }),

    isBookmarked: (bookId, cfi) =>
      Effect.gen(function* () {
        const allEntries = yield* Effect.tryPromise({
          try: () => entries<string, unknown>(bookmarkStore),
          catch: (cause) => new BookmarkError({ operation: "isBookmarked", cause }),
        });
        return yield* Effect.try({
          try: () =>
            allEntries.some((entry) => {
              if (!isWellFormedEntry(entry)) return false;
              const [, raw] = entry;
              if (raw == null || typeof raw !== "object") return false;
              const bookmark = decodeBookmark(raw);
              return (
                bookmark.bookId === bookId && bookmark.cfi === cfi && isActiveBookmark(bookmark)
              );
            }),
          catch: (cause) => new DecodeError({ operation: "isBookmarked", cause }),
        });
      }),
  };
}

export const BookmarkServiceLive = Layer.sync(BookmarkService, () =>
  makeBookmarkService({ bookmarkStore: getBookmarkStore() }),
);
