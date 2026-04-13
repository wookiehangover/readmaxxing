import { createStore, get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import { StorageError, BookNotFoundError, DecodeError } from "~/lib/errors";

// --- Schema ---

export const BookFormatSchema = Schema.Literal("epub", "pdf");
export type BookFormat = typeof BookFormatSchema.Type;

export const BookMetaSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  author: Schema.String,
  coverImage: Schema.NullOr(Schema.instanceOf(Blob)),
  format: Schema.optionalWith(BookFormatSchema, { default: () => "epub" as const }),
});

/** Metadata-only book record (no binary epub data). */
export type BookMeta = typeof BookMetaSchema.Type;

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
    readonly deleteBook: (id: string) => Effect.Effect<void, StorageError>;
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
          await set(meta.id, meta, bookStore);
          await set(meta.id, data, bookDataStore);
        },
        catch: (cause) => new StorageError({ operation: "saveBook", cause }),
      }),

    updateBookMeta: (meta: BookMeta) =>
      Effect.tryPromise({
        try: () => set(meta.id, meta, bookStore),
        catch: (cause) => new StorageError({ operation: "updateBookMeta", cause }),
      }),

    getBooks: () =>
      Effect.gen(function* () {
        const allEntries = yield* Effect.tryPromise({
          try: () => entries<string, unknown>(bookStore),
          catch: (cause) => new StorageError({ operation: "getBooks", cause }),
        });
        return yield* Effect.try({
          try: () =>
            allEntries
              .map(([, raw]) => raw)
              .filter(Boolean)
              .map((raw) => decodeBookMeta(raw)),
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
        if (!raw || !raw.data || !(raw.data instanceof ArrayBuffer)) {
          return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
        }

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
      }),

    deleteBook: (id: string) =>
      Effect.tryPromise({
        try: async () => {
          await del(id, bookStore);
          // Best-effort cleanup of binary data
          try {
            await del(id, bookDataStore);
          } catch {
            /* ignore */
          }
        },
        catch: (cause) => new StorageError({ operation: "deleteBook", cause }),
      }),
  };
}

export const BookServiceLive = Layer.sync(BookService, () =>
  makeBookService({ bookStore: getBookStore(), bookDataStore: getBookDataStore() }),
);
