import { createStore, get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import { StorageError, BookNotFoundError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";

// --- Schema ---

export const BookFormatSchema = Schema.Literal("epub", "pdf");
export type BookFormat = typeof BookFormatSchema.Type;

export const BookMetaSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  author: Schema.String,
  coverImage: Schema.NullOr(Schema.instanceOf(Blob)),
  format: Schema.optionalWith(BookFormatSchema, { default: () => "epub" as const }),
  /** Vercel Blob URL for cover image (set during sync upload). */
  remoteCoverUrl: Schema.optional(Schema.String),
  /** Vercel Blob URL for epub/pdf file (set during sync upload). */
  remoteFileUrl: Schema.optional(Schema.String),
  /** SHA-256 hash of the file data, used for deduplication during sync. */
  fileHash: Schema.optional(Schema.String),
  /** Timestamp of last mutation (creation or update). Used for LWW sync. */
  updatedAt: Schema.optional(Schema.Number),
  /** Soft-delete timestamp. When set, the book is considered deleted. */
  deletedAt: Schema.optional(Schema.Number),
  /** Whether this device has the epub/pdf file locally in IDB. */
  hasLocalFile: Schema.optional(Schema.Boolean),
});

/** Metadata-only book record (no binary epub data). */
export type BookMeta = typeof BookMetaSchema.Type;

/** Returns true if the book was synced from another device and hasn't been downloaded yet. */
export function bookNeedsDownload(book: BookMeta): boolean {
  return !!book.remoteFileUrl && !book.hasLocalFile;
}

const decodeBookMeta = Schema.decodeUnknownSync(BookMetaSchema);

/**
 * Full book record including binary data.
 * @deprecated Prefer BookMeta for listings. Only use Book when you also need the ArrayBuffer.
 */
export interface Book extends BookMeta {
  data: ArrayBuffer;
}

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

let _bookStore: ReturnType<typeof createStore> | null = null;
let _bookDataStore: ReturnType<typeof createStore> | null = null;

function getBookStore() {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

function getBookDataStore() {
  if (!_bookDataStore) _bookDataStore = createStore("ebook-reader-book-data", "book-data");
  return _bookDataStore;
}

let _migrated = false;

async function migrateHasLocalFile(): Promise<void> {
  const bookStore = getBookStore();
  const bookDataStore = getBookDataStore();
  const allEntries = await entries<string, BookMeta>(bookStore);

  for (const [id, meta] of allEntries) {
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

// --- Effect Service ---

export class BookService extends Context.Tag("BookService")<
  BookService,
  {
    readonly saveBook: (meta: BookMeta, data: ArrayBuffer) => Effect.Effect<void, StorageError>;
    readonly updateBookMeta: (meta: BookMeta) => Effect.Effect<void, StorageError>;
    readonly getBooks: () => Effect.Effect<BookMeta[], StorageError | DecodeError>;
    readonly getBook: (
      id: string,
    ) => Effect.Effect<BookMeta, BookNotFoundError | StorageError | DecodeError>;
    readonly getBookData: (
      id: string,
    ) => Effect.Effect<ArrayBuffer, BookNotFoundError | StorageError | DecodeError>;
    readonly deleteBook: (id: string) => Effect.Effect<void, StorageError | DecodeError>;
  }
>() {}

export interface BookServiceStores {
  readonly bookStore: UseStore;
  readonly bookDataStore: UseStore;
}

export function makeBookService(stores: BookServiceStores): BookService["Type"] {
  const { bookStore, bookDataStore } = stores;
  return {
    saveBook: (meta: BookMeta, data: ArrayBuffer) =>
      Effect.tryPromise({
        try: async () => {
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
        },
        catch: (cause) => new StorageError({ operation: "saveBook", cause }),
      }),

    updateBookMeta: (meta: BookMeta) =>
      Effect.tryPromise({
        try: async () => {
          const stamped = { ...meta, updatedAt: Date.now() };
          await set(meta.id, stamped, bookStore);
          recordChange({
            entity: "book",
            entityId: meta.id,
            operation: "put",
            data: stamped,
            timestamp: stamped.updatedAt,
          }).catch(console.error);
        },
        catch: (cause) => new StorageError({ operation: "updateBookMeta", cause }),
      }),

    getBooks: () =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => ensureMigrated(),
          catch: (cause) => new StorageError({ operation: "getBooks.migrateHasLocalFile", cause }),
        });
        const allEntries = yield* Effect.tryPromise({
          try: () => entries<string, unknown>(bookStore),
          catch: (cause) => new StorageError({ operation: "getBooks", cause }),
        });
        return yield* Effect.try({
          try: () =>
            allEntries
              .map(([, raw]) => raw)
              .filter(Boolean)
              .map((raw) => decodeBookMeta(raw))
              .filter((book) => book.deletedAt === undefined),
          catch: (cause) => new DecodeError({ operation: "getBooks", cause }),
        });
      }),

    getBook: (id: string) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(id, bookStore),
          catch: (cause) => new StorageError({ operation: "getBook", cause }),
        });
        if (!raw) {
          return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
        }
        return yield* Effect.try({
          try: () => decodeBookMeta(raw),
          catch: (cause) => new DecodeError({ operation: "getBook", cause }),
        });
      }),

    getBookData: (id: string) =>
      Effect.gen(function* () {
        const data = yield* Effect.tryPromise({
          try: () => get<ArrayBuffer>(id, bookDataStore),
          catch: (cause) => new StorageError({ operation: "getBookData", cause }),
        });
        if (data) return data;

        // Lazy migration: check old-format record in bookStore for inline `data` field
        const raw = yield* Effect.tryPromise({
          try: () => get<Record<string, unknown>>(id, bookStore),
          catch: (cause) => new StorageError({ operation: "getBookData.migrate.read", cause }),
        });
        if (raw?.data && raw.data instanceof ArrayBuffer) {
          const migratedData = raw.data as ArrayBuffer;

          // Move binary data to the dedicated store and strip it from the metadata record
          yield* Effect.tryPromise({
            try: async () => {
              await set(id, migratedData, bookDataStore);
              const { data: _, ...metaOnly } = raw;
              await set(id, metaOnly, bookStore);
            },
            catch: (cause) => new StorageError({ operation: "getBookData.migrate.write", cause }),
          });

          return migratedData;
        }

        // On-demand download: if the book has a remote file URL, fetch and cache it
        const meta = raw
          ? yield* Effect.try({
              try: () => decodeBookMeta(raw),
              catch: (cause) => new DecodeError({ operation: "getBookData.decodeMeta", cause }),
            })
          : null;

        if (meta?.remoteFileUrl) {
          const downloaded = yield* Effect.tryPromise({
            try: async () => {
              const res = await fetch(
                `/api/sync/files/download?bookId=${encodeURIComponent(id)}&type=file`,
                { credentials: "include" },
              );
              if (!res.ok) {
                throw new Error(`Download failed: ${res.status} ${res.statusText}`);
              }
              return res.arrayBuffer();
            },
            catch: (cause) => new StorageError({ operation: "getBookData.download", cause }),
          });

          // Cache the downloaded file locally
          yield* Effect.tryPromise({
            try: () => set(id, downloaded, bookDataStore),
            catch: (cause) => new StorageError({ operation: "getBookData.cacheFile", cause }),
          });

          // Mark book as having local file data
          yield* Effect.tryPromise({
            try: () => set(id, { ...meta, hasLocalFile: true }, bookStore),
            catch: (cause) => new StorageError({ operation: "getBookData.markLocal", cause }),
          });

          // Also download and cache the cover image if available
          if (meta.remoteCoverUrl && !meta.coverImage) {
            yield* Effect.tryPromise({
              try: async () => {
                const coverRes = await fetch(
                  `/api/sync/files/download?bookId=${encodeURIComponent(id)}&type=cover`,
                  { credentials: "include" },
                );
                if (coverRes.ok) {
                  const coverBlob = await coverRes.blob();
                  const updated = { ...meta, coverImage: coverBlob, hasLocalFile: true };
                  await set(id, updated, bookStore);
                }
              },
              catch: () => {
                /* cover caching is best-effort, ignore errors */
              },
            }).pipe(Effect.catchAll(() => Effect.void));
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

        return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
      }),

    deleteBook: (id: string) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(id, bookStore),
          catch: (cause) => new StorageError({ operation: "deleteBook.read", cause }),
        });
        if (raw) {
          // Soft-delete: set deletedAt timestamp, keep data for sync
          const existing = yield* Effect.try({
            try: () => decodeBookMeta(raw),
            catch: (cause) => new DecodeError({ operation: "deleteBook.decode", cause }),
          });
          const now = Date.now();
          const tombstone = { ...existing, deletedAt: now, updatedAt: now };
          yield* Effect.tryPromise({
            try: () => set(id, tombstone, bookStore),
            catch: (cause) => new StorageError({ operation: "deleteBook.write", cause }),
          });
          recordChange({
            entity: "book",
            entityId: id,
            operation: "delete",
            data: tombstone,
            timestamp: now,
          }).catch(console.error);
        }
      }),
  };
}

export const BookServiceLive = Layer.sync(BookService, () =>
  makeBookService({ bookStore: getBookStore(), bookDataStore: getBookDataStore() }),
);
