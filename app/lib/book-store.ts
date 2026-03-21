import { createStore, get, set, del, keys } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { StorageError, BookNotFoundError, PositionError } from "~/lib/errors";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverImage: Blob | null;
  data: ArrayBuffer;
}

// --- idb-keyval stores (internal) ---

const bookStore = createStore("ebook-reader-db", "books");
const positionStore = createStore("ebook-reader-positions", "positions");

// --- Effect Service ---

class BookService extends Context.Tag("BookService")<
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

const BookServiceLive = Layer.succeed(BookService, {
  saveBook: (book: Book) =>
    Effect.tryPromise({
      try: () => set(book.id, book, bookStore),
      catch: (cause) => new StorageError({ operation: "saveBook", cause }),
    }),

  getBooks: () =>
    Effect.tryPromise({
      try: async () => {
        const allKeys = await keys(bookStore);
        const books: Book[] = [];
        for (const key of allKeys) {
          const book = await get<Book>(key, bookStore);
          if (book) {
            books.push(book);
          }
        }
        return books;
      },
      catch: (cause) => new StorageError({ operation: "getBooks", cause }),
    }),

  getBook: (id: string) =>
    Effect.gen(function* () {
      const book = yield* Effect.tryPromise({
        try: () => get<Book>(id, bookStore),
        catch: (cause) => new StorageError({ operation: "getBook", cause }),
      });
      if (!book) {
        return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
      }
      return book;
    }),

  deleteBook: (id: string) =>
    Effect.tryPromise({
      try: () => del(id, bookStore),
      catch: (cause) => new StorageError({ operation: "deleteBook", cause }),
    }),

  savePosition: (bookId: string, cfi: string) =>
    Effect.tryPromise({
      try: () => set(bookId, cfi, positionStore),
      catch: (cause) => new PositionError({ operation: "savePosition", bookId, cause }),
    }),

  getPosition: (bookId: string) =>
    Effect.tryPromise({
      try: async () => {
        const cfi = await get<string>(bookId, positionStore);
        return cfi ?? null;
      },
      catch: (cause) => new PositionError({ operation: "getPosition", bookId, cause }),
    }),
});

export { BookService, BookServiceLive };
