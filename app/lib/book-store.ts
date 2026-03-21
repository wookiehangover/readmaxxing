import { createStore, get, set, del, entries } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { StorageError, BookNotFoundError, PositionError } from "~/lib/errors";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverImage: Blob | null;
  data: ArrayBuffer;
}

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

let _bookStore: ReturnType<typeof createStore> | null = null;
let _positionStore: ReturnType<typeof createStore> | null = null;

function getBookStore() {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

function getPositionStore() {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

// --- Effect Service ---

export class BookService extends Context.Tag("BookService")<
  BookService,
  {
    readonly saveBook: (book: Book) => Effect.Effect<void, StorageError>;
    readonly getBooks: () => Effect.Effect<Book[], StorageError>;
    readonly getBook: (id: string) => Effect.Effect<Book, BookNotFoundError | StorageError>;
    readonly deleteBook: (id: string) => Effect.Effect<void, StorageError>;
    readonly savePosition: (bookId: string, cfi: string) => Effect.Effect<void, PositionError>;
    readonly getPosition: (bookId: string) => Effect.Effect<string | null, PositionError>;
  }
>() {}

export const BookServiceLive = Layer.succeed(BookService, {
  saveBook: (book: Book) =>
    Effect.tryPromise({
      try: () => set(book.id, book, getBookStore()),
      catch: (cause) => new StorageError({ operation: "saveBook", cause }),
    }),

  getBooks: () =>
    Effect.tryPromise({
      try: async () => {
        const allEntries = await entries<string, Book>(getBookStore());
        return allEntries.map(([, book]) => book).filter(Boolean);
      },
      catch: (cause) => new StorageError({ operation: "getBooks", cause }),
    }),

  getBook: (id: string) =>
    Effect.gen(function* () {
      const book = yield* Effect.tryPromise({
        try: () => get<Book>(id, getBookStore()),
        catch: (cause) => new StorageError({ operation: "getBook", cause }),
      });
      if (!book) {
        return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
      }
      return book;
    }),

  deleteBook: (id: string) =>
    Effect.tryPromise({
      try: () => del(id, getBookStore()),
      catch: (cause) => new StorageError({ operation: "deleteBook", cause }),
    }),

  savePosition: (bookId: string, cfi: string) =>
    Effect.tryPromise({
      try: () => set(bookId, cfi, getPositionStore()),
      catch: (cause) => new PositionError({ operation: "savePosition", bookId, cause }),
    }),

  getPosition: (bookId: string) =>
    Effect.tryPromise({
      try: async () => {
        const cfi = await get<string>(bookId, getPositionStore());
        return cfi ?? null;
      },
      catch: (cause) => new PositionError({ operation: "getPosition", bookId, cause }),
    }),
});
