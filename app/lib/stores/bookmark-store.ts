import { get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { BookmarkError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { isWellFormedEntry } from "~/lib/sync/idb-entry";
import { getBookmarkStore } from "~/lib/sync/stores";

export interface Bookmark {
  id: string;
  bookId: string;
  cfi?: string;
  label?: string;
  pageNumber?: number;
  displayPage?: number;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
}

function decodeBookmark(raw: unknown): Bookmark {
  if (!raw || typeof raw !== "object") throw new Error("Invalid bookmark");
  const bookmark = raw as Record<string, unknown>;
  if (
    typeof bookmark.id !== "string" ||
    typeof bookmark.bookId !== "string" ||
    typeof bookmark.createdAt !== "number" ||
    (bookmark.cfi !== undefined && typeof bookmark.cfi !== "string") ||
    (bookmark.label !== undefined && typeof bookmark.label !== "string") ||
    (bookmark.pageNumber !== undefined && typeof bookmark.pageNumber !== "number") ||
    (bookmark.displayPage !== undefined && typeof bookmark.displayPage !== "number") ||
    (bookmark.updatedAt !== undefined && typeof bookmark.updatedAt !== "number") ||
    (bookmark.deletedAt !== undefined && typeof bookmark.deletedAt !== "number")
  ) {
    throw new Error("Invalid bookmark");
  }
  return bookmark as unknown as Bookmark;
}

export interface BookmarkServiceStores {
  readonly bookmarkStore: UseStore;
}

function isActiveBookmark(bookmark: Bookmark): boolean {
  return bookmark.deletedAt === undefined;
}

export function makeBookmarkService(stores: BookmarkServiceStores) {
  const { bookmarkStore } = stores;
  return {
    async getBookmarksByBook(bookId: string) {
      let allEntries: [IDBValidKey, unknown][];
      try {
        allEntries = await entries(bookmarkStore);
      } catch (cause) {
        throw new BookmarkError({ operation: "getBookmarksByBook", cause });
      }
      try {
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
      } catch (cause) {
        throw new DecodeError({ operation: "getBookmarksByBook", cause });
      }
    },

    async saveBookmark(bookmark: Bookmark) {
      try {
        const stamped = { ...bookmark, updatedAt: bookmark.updatedAt ?? Date.now() };
        await set(bookmark.id, stamped, bookmarkStore);
        recordChange({
          entity: "bookmark",
          entityId: bookmark.id,
          operation: "put",
          data: stamped,
          timestamp: stamped.updatedAt,
        }).catch(console.error);
        return stamped;
      } catch (cause) {
        throw new BookmarkError({ operation: "saveBookmark", bookmarkId: bookmark.id, cause });
      }
    },

    async deleteBookmark(id: string) {
      let raw: unknown;
      try {
        raw = await get(id, bookmarkStore);
      } catch (cause) {
        throw new BookmarkError({ operation: "deleteBookmark.read", bookmarkId: id, cause });
      }
      if (!raw) return;
      let existing: Bookmark;
      try {
        existing = decodeBookmark(raw);
      } catch (cause) {
        throw new DecodeError({ operation: "deleteBookmark.decode", cause });
      }
      const now = Date.now();
      const tombstone = { ...existing, deletedAt: now, updatedAt: now };
      try {
        await set(id, tombstone, bookmarkStore);
      } catch (cause) {
        throw new BookmarkError({ operation: "deleteBookmark.write", bookmarkId: id, cause });
      }
      recordChange({
        entity: "bookmark",
        entityId: id,
        operation: "delete",
        data: tombstone,
        timestamp: now,
      }).catch(console.error);
    },

    async isBookmarked(bookId: string, cfi: string) {
      let allEntries: [IDBValidKey, unknown][];
      try {
        allEntries = await entries(bookmarkStore);
      } catch (cause) {
        throw new BookmarkError({ operation: "isBookmarked", cause });
      }
      try {
        return allEntries.some((entry) => {
          if (!isWellFormedEntry(entry)) return false;
          const [, raw] = entry;
          if (raw == null || typeof raw !== "object") return false;
          try {
            const bookmark = decodeBookmark(raw);
            return bookmark.bookId === bookId && bookmark.cfi === cfi && isActiveBookmark(bookmark);
          } catch {
            return false;
          }
        });
      } catch (cause) {
        throw new DecodeError({ operation: "isBookmarked", cause });
      }
    },
  };
}

export const BookmarkService = makeBookmarkService({ bookmarkStore: getBookmarkStore() });
