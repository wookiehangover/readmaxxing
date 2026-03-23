import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore, set, get, del, entries } from "idb-keyval";
import { BookService } from "~/lib/book-store";
import type { Book } from "~/lib/book-store";
import { StorageError, BookNotFoundError, PositionError } from "~/lib/errors";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: overrides.id ?? "book-1",
    title: overrides.title ?? "Test Book",
    author: overrides.author ?? "Test Author",
    coverImage: overrides.coverImage ?? null,
    data: overrides.data ?? new ArrayBuffer(8),
  };
}

let testCounter = 0;

function makeTestLayer() {
  const suffix = `test-${++testCounter}-${Date.now()}`;
  const bookStore = createStore(`book-db-${suffix}`, "books");
  const posStore = createStore(`pos-db-${suffix}`, "positions");
  const locStore = createStore(`loc-db-${suffix}`, "locations");

  return Layer.succeed(BookService, {
    saveBook: (book: Book) =>
      Effect.tryPromise({
        try: () => set(book.id, book, bookStore),
        catch: (cause) => new StorageError({ operation: "saveBook", cause }),
      }),
    getBooks: () =>
      Effect.tryPromise({
        try: async () => {
          const allEntries = await entries<string, Book>(bookStore);
          return allEntries.map(([, book]) => book).filter(Boolean);
        },
        catch: (cause) => new StorageError({ operation: "getBooks", cause }),
      }),
    getBook: (id: string) =>
      Effect.gen(function* () {
        const book = yield* Effect.tryPromise({
          try: () => get<Book>(id, bookStore),
          catch: (cause) => new StorageError({ operation: "getBook", cause }),
        });
        if (!book) return yield* Effect.fail(new BookNotFoundError({ bookId: id }));
        return book;
      }),
    deleteBook: (id: string) =>
      Effect.tryPromise({
        try: () => del(id, bookStore),
        catch: (cause) => new StorageError({ operation: "deleteBook", cause }),
      }),
    savePosition: (bookId: string, cfi: string) =>
      Effect.tryPromise({
        try: () => set(bookId, cfi, posStore),
        catch: (cause) => new PositionError({ operation: "savePosition", bookId, cause }),
      }),
    getPosition: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const cfi = await get<string>(bookId, posStore);
          return cfi ?? null;
        },
        catch: (cause) => new PositionError({ operation: "getPosition", bookId, cause }),
      }),
    saveLocations: (bookId: string, json: string) =>
      Effect.tryPromise({
        try: () => set(bookId, json, locStore),
        catch: (cause) => new StorageError({ operation: "saveLocations", cause }),
      }),
    getLocations: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const loc = await get<string>(bookId, locStore);
          return loc ?? null;
        },
        catch: (cause) => new StorageError({ operation: "getLocations", cause }),
      }),
  });
}

describe("BookService", () => {
  describe("saveBook + getBooks", () => {
    it("saves and retrieves books", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe("book-1");
      expect(books[0].title).toBe("Test Book");
    });

    it("returns empty array when no books", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toEqual([]);
    });
  });

  describe("getBook", () => {
    it("retrieves a single book by id", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
      const result = await run(BookService.pipe(Effect.andThen((s) => s.getBook("book-1"))));
      expect(result.id).toBe("book-1");
      expect(result.title).toBe("Test Book");
    });

    it("fails with BookNotFoundError for missing book", async () => {
      const layer = makeTestLayer();
      const exit = await Effect.runPromiseExit(
        Effect.provide(BookService.pipe(Effect.andThen((s) => s.getBook("nonexistent"))), layer),
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect((exit.cause as any).error?._tag).toBe("BookNotFoundError");
      }
    });
  });

  describe("deleteBook", () => {
    it("deletes a book", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
      await run(BookService.pipe(Effect.andThen((s) => s.deleteBook("book-1"))));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toEqual([]);
    });
  });

  describe("savePosition + getPosition", () => {
    it("saves and retrieves a reading position", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await run(BookService.pipe(Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/4)"))));
      const pos = await run(BookService.pipe(Effect.andThen((s) => s.getPosition("book-1"))));
      expect(pos).toBe("epubcfi(/6/4)");
    });

    it("returns null for missing position", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      const pos = await run(BookService.pipe(Effect.andThen((s) => s.getPosition("no-book"))));
      expect(pos).toBeNull();
    });

    it("overwrites an existing position", async () => {
      const layer = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, layer));
      await run(BookService.pipe(Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/4)"))));
      await run(BookService.pipe(Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/8)"))));
      const pos = await run(BookService.pipe(Effect.andThen((s) => s.getPosition("book-1"))));
      expect(pos).toBe("epubcfi(/6/8)");
    });
  });
});
