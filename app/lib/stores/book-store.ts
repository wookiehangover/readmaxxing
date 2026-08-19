import { get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { StorageError, BookNotFoundError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { getBookStore, getBookDataStore } from "~/lib/sync/stores";

export type BookFormat = "epub" | "pdf";

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  coverImage: Blob | null;
  format: BookFormat;
  /** Vercel Blob URL for cover image (set during sync upload). */
  remoteCoverUrl?: string;
  /** Vercel Blob URL for epub/pdf file (set during sync upload). */
  remoteFileUrl?: string;
  /** SHA-256 hash of the file data, used for deduplication during sync. */
  fileHash?: string;
  /** User ID of the person who shared this book, if imported via share link. */
  sharedBy?: string;
  /** Share link ID used to import this book, if imported via share link. */
  shareId?: string;
  /** Timestamp of last mutation (creation or update). Used for LWW sync. */
  updatedAt?: number;
  /** Soft-delete timestamp. When set, the book is considered deleted. */
  deletedAt?: number;
  /** Whether this device has the epub/pdf file locally in IDB. */
  hasLocalFile?: boolean;
}

/** Returns true if the book was synced from another device and hasn't been downloaded yet. */
export function bookNeedsDownload(book: BookMeta): boolean {
  return !!book.remoteFileUrl && !book.hasLocalFile;
}

const decodeBookMeta = (raw: unknown): BookMeta => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid book metadata");
  const book = raw as Record<string, unknown>;
  const format = book.format ?? "epub";
  if (
    typeof book.id !== "string" ||
    typeof book.title !== "string" ||
    typeof book.author !== "string" ||
    (book.coverImage !== null && !(book.coverImage instanceof Blob)) ||
    (format !== "epub" && format !== "pdf")
  ) {
    throw new Error("Invalid book metadata");
  }
  return { ...book, format } as unknown as BookMeta;
};

function isBookStoreEntry(entry: unknown): entry is [IDBValidKey, unknown] {
  // Legacy or corrupted IndexedDB iterations can surface missing tuple entries;
  // guard before reading entry[0]/entry[1] so signed-out local uploads still work.
  return Array.isArray(entry) && entry.length >= 2;
}

/**
 * Full book record including binary data.
 * @deprecated Prefer BookMeta for listings. Only use Book when you also need the ArrayBuffer.
 */
export interface Book extends BookMeta {
  data: ArrayBuffer;
}

// --- idb-keyval stores imported from ~/lib/sync/stores ---

let _migrated = false;

async function migrateHasLocalFile(): Promise<void> {
  const bookStore = getBookStore();
  const bookDataStore = getBookDataStore();
  const allEntries = await entries<string, unknown>(bookStore);

  for (const entry of allEntries) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const id = entry[0];
    const meta = entry[1] as BookMeta | null | undefined;
    if (!meta || typeof meta !== "object") continue;
    if (meta.hasLocalFile) continue;

    const data = await get(id, bookDataStore);
    if (data) {
      await set(id, { ...meta, hasLocalFile: true }, bookStore);
    }
  }
}

async function ensureMigrated() {
  if (_migrated) return;
  _migrated = true;
  await migrateHasLocalFile();
}

export interface BookServiceStores {
  readonly bookStore: UseStore;
  readonly bookDataStore: UseStore;
}

async function storage<T>(operation: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw new StorageError({ operation, cause });
  }
}

function decode(operation: string, raw: unknown): BookMeta {
  try {
    return decodeBookMeta(raw);
  } catch (cause) {
    throw new DecodeError({ operation, cause });
  }
}

export function makeBookService(stores: BookServiceStores) {
  const { bookStore, bookDataStore } = stores;

  const readBook = async (id: string, operation: string) => {
    const raw = await storage(operation, () => get<unknown>(id, bookStore));
    if (!raw) throw new BookNotFoundError({ bookId: id });
    return decode(operation, raw);
  };

  return {
    async saveBook(meta: BookMeta, data: ArrayBuffer) {
      return storage("saveBook", async () => {
        const stamped = { ...meta, hasLocalFile: true, updatedAt: meta.updatedAt ?? Date.now() };
        await set(meta.id, stamped, bookStore);
        await set(meta.id, data, bookDataStore);
        recordChange({
          entity: "book",
          entityId: meta.id,
          operation: "put",
          data: stamped,
          timestamp: stamped.updatedAt,
        }).catch(console.error);
      });
    },

    async updateBookMeta(meta: BookMeta) {
      return storage("updateBookMeta", async () => {
        const stamped = { ...meta, updatedAt: Date.now() };
        await set(meta.id, stamped, bookStore);
        recordChange({
          entity: "book",
          entityId: meta.id,
          operation: "put",
          data: stamped,
          timestamp: stamped.updatedAt,
        }).catch(console.error);
      });
    },

    async replaceBookFile(
      id: string,
      data: ArrayBuffer,
      meta: { coverImage: Blob | null; fileHash: string },
    ) {
      const raw = await storage("replaceBookFile.read", () => get<unknown>(id, bookStore));
      if (!raw) throw new BookNotFoundError({ bookId: id });
      const existing = decode("replaceBookFile.decode", raw);
      const stamped = {
        ...existing,
        coverImage: meta.coverImage,
        fileHash: meta.fileHash,
        remoteCoverUrl: undefined,
        remoteFileUrl: undefined,
        hasLocalFile: true,
        updatedAt: Date.now(),
      };

      await storage("replaceBookFile.write", async () => {
        await set(id, data, bookDataStore);
        await set(id, stamped, bookStore);
        recordChange({
          entity: "book",
          entityId: id,
          operation: "put",
          data: stamped,
          timestamp: stamped.updatedAt,
        }).catch(console.error);
      });
    },

    async getBooks() {
      await storage("getBooks.migrateHasLocalFile", ensureMigrated);
      const allEntries = await storage("getBooks", () => entries<string, unknown>(bookStore));
      const books: BookMeta[] = [];
      for (const entry of allEntries) {
        if (!isBookStoreEntry(entry)) continue;
        const [key, raw] = entry;
        if (raw == null || typeof raw !== "object") continue;
        try {
          const meta = decodeBookMeta(raw);
          if (meta.deletedAt === undefined) books.push(meta);
        } catch (err) {
          console.warn(`[book-store] Skipping malformed book record (key=${String(key)})`, err);
        }
      }
      return books;
    },

    getBook: (id: string) => readBook(id, "getBook"),

    // Same as getBook, but explicitly returns the record even when soft-deleted
    // (deletedAt set). Used by the power-user details editor so a soft-deleted
    // book can still be inspected and restored.
    getBookIncludingDeleted: (id: string) => readBook(id, "getBookIncludingDeleted"),

    async getBookData(id: string) {
      const data = await storage("getBookData", () => get<ArrayBuffer>(id, bookDataStore));
      if (data) return data;

      // Lazy migration: check old-format record in bookStore for inline `data` field
      const raw = await storage("getBookData.migrate.read", () =>
        get<Record<string, unknown>>(id, bookStore),
      );
      if (raw?.data && raw.data instanceof ArrayBuffer) {
        const migratedData = raw.data as ArrayBuffer;

        // Move binary data to the dedicated store and strip it from the metadata record
        await storage("getBookData.migrate.write", async () => {
          await set(id, migratedData, bookDataStore);
          const { data: _, ...metaOnly } = raw;
          await set(id, metaOnly, bookStore);
        });

        return migratedData;
      }

      // On-demand download: if the book has a remote file URL, fetch and cache it
      const meta = raw ? decode("getBookData.decodeMeta", raw) : null;

      if (meta?.remoteFileUrl) {
        const downloaded = await storage("getBookData.download", async () => {
          const res = await fetch(
            `/api/sync/files/download?bookId=${encodeURIComponent(id)}&type=file`,
            { credentials: "include" },
          );
          if (!res.ok) {
            throw new Error(`Download failed: ${res.status} ${res.statusText}`);
          }
          return res.arrayBuffer();
        });

        // Cache the downloaded file locally
        await storage("getBookData.cacheFile", () => set(id, downloaded, bookDataStore));

        // Mark book as having local file data
        await storage("getBookData.markLocal", () =>
          set(id, { ...meta, hasLocalFile: true }, bookStore),
        );

        // Also download and cache the cover image if available
        if (meta.remoteCoverUrl && !meta.coverImage) {
          try {
            const coverRes = await fetch(
              `/api/sync/files/download?bookId=${encodeURIComponent(id)}&type=cover`,
              { credentials: "include" },
            );
            if (coverRes.ok) {
              const coverBlob = await coverRes.blob();
              const updated = { ...meta, coverImage: coverBlob, hasLocalFile: true };
              await set(id, updated, bookStore);
            }
          } catch {
            // Cover caching is best-effort.
          }
        }

        // Notify library views that a download completed
        if (typeof window !== "undefined") {
          queueMicrotask(() => {
            window.dispatchEvent(
              new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
            );
          });
        }

        return downloaded;
      }

      throw new BookNotFoundError({ bookId: id });
    },

    async findByFileHash(hash: string) {
      const allEntries = await storage("findByFileHash", () => entries<string, unknown>(bookStore));
      for (const entry of allEntries) {
        if (!isBookStoreEntry(entry)) continue;
        const [key, raw] = entry;
        if (raw == null || typeof raw !== "object") continue;
        try {
          const meta = decodeBookMeta(raw);
          if (meta.deletedAt !== undefined) continue;
          if (meta.fileHash === hash) return meta;
        } catch (err) {
          console.warn(`[book-store] Skipping malformed book record (key=${String(key)})`, err);
        }
      }
      return null;
    },

    async deleteBook(id: string) {
      const raw = await storage("deleteBook.read", () => get<unknown>(id, bookStore));
      if (raw) {
        // Soft-delete: set deletedAt timestamp, keep data for sync
        const existing = decode("deleteBook.decode", raw);
        const now = Date.now();
        const tombstone = { ...existing, deletedAt: now, updatedAt: now };
        await storage("deleteBook.write", () => set(id, tombstone, bookStore));
        recordChange({
          entity: "book",
          entityId: id,
          operation: "delete",
          data: tombstone,
          timestamp: now,
        }).catch(console.error);
      }
    },
  };
}

type BookServiceApi = ReturnType<typeof makeBookService>;
let defaultService: BookServiceApi | undefined;

function getDefaultService(): BookServiceApi {
  defaultService ??= makeBookService({
    bookStore: getBookStore(),
    bookDataStore: getBookDataStore(),
  });
  return defaultService;
}

export const BookService: BookServiceApi = {
  saveBook: (...args) => getDefaultService().saveBook(...args),
  updateBookMeta: (...args) => getDefaultService().updateBookMeta(...args),
  replaceBookFile: (...args) => getDefaultService().replaceBookFile(...args),
  getBooks: (...args) => getDefaultService().getBooks(...args),
  getBook: (...args) => getDefaultService().getBook(...args),
  getBookIncludingDeleted: (...args) => getDefaultService().getBookIncludingDeleted(...args),
  getBookData: (...args) => getDefaultService().getBookData(...args),
  deleteBook: (...args) => getDefaultService().deleteBook(...args),
  findByFileHash: (...args) => getDefaultService().findByFileHash(...args),
};
