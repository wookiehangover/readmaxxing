import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { createStore, set, get } from "idb-keyval";
import { BookService, makeBookService } from "~/lib/book-store";
import type { Book } from "~/lib/book-store";
import { ReadingPositionService, makePositionService } from "~/lib/position-store";

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: overrides.id ?? "book-1",
    title: overrides.title ?? "Test Book",
    author: overrides.author ?? "Test Author",
    coverImage: overrides.coverImage ?? null,
    format: overrides.format ?? ("epub" as const),
    data: overrides.data ?? new ArrayBuffer(8),
  };
}

let testCounter = 0;

function makeTestLayer() {
  const suffix = `test-${++testCounter}-${Date.now()}`;
  const bookStore = createStore(`book-db-${suffix}`, "books");
  const bookDataStore = createStore(`book-data-db-${suffix}`, "book-data");
  const posStore = createStore(`pos-db-${suffix}`, "positions");

  const bookLayer = Layer.succeed(BookService, makeBookService({ bookStore, bookDataStore }));

  const positionLayer = Layer.succeed(
    ReadingPositionService,
    makePositionService({ positionStore: posStore }),
  );

  return { bookLayer, positionLayer };
}

describe("BookService", () => {
  describe("saveBook + getBooks", () => {
    it("saves and retrieves books", async () => {
      const { bookLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book, book.data))));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe("book-1");
      expect(books[0].title).toBe("Test Book");
    });

    it("returns empty array when no books", async () => {
      const { bookLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toEqual([]);
    });
  });

  describe("getBook", () => {
    it("retrieves a single book by id", async () => {
      const { bookLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book, book.data))));
      const result = await run(BookService.pipe(Effect.andThen((s) => s.getBook("book-1"))));
      expect(result.id).toBe("book-1");
      expect(result.title).toBe("Test Book");
    });

    it("fails with BookNotFoundError for missing book", async () => {
      const { bookLayer } = makeTestLayer();
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          BookService.pipe(Effect.andThen((s) => s.getBook("nonexistent"))),
          bookLayer,
        ),
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect((exit.cause as any).error?._tag).toBe("BookNotFoundError");
      }
    });
  });

  describe("deleteBook", () => {
    it("deletes a book", async () => {
      const { bookLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));
      const book = makeBook();
      await run(BookService.pipe(Effect.andThen((s) => s.saveBook(book, book.data))));
      await run(BookService.pipe(Effect.andThen((s) => s.deleteBook("book-1"))));
      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toEqual([]);
    });
  });

  describe("lazy migration from old-format records", () => {
    it("migrates inline data from bookStore to bookDataStore on getBookData", async () => {
      const suffix = `test-${++testCounter}-${Date.now()}`;
      const bookStore = createStore(`book-db-${suffix}`, "books");
      const bookDataStore = createStore(`book-data-db-${suffix}`, "book-data");

      // Write an old-format record with inline data directly to bookStore
      const oldRecord = {
        id: "old-book",
        title: "Old Book",
        author: "Old Author",
        coverImage: null,
        data: new ArrayBuffer(16),
      };
      await set("old-book", oldRecord, bookStore);

      const bookLayer = Layer.succeed(BookService, makeBookService({ bookStore, bookDataStore }));
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));

      // getBookData should find the inline data and migrate it
      const data = await run(BookService.pipe(Effect.andThen((s) => s.getBookData("old-book"))));
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(data.byteLength).toBe(16);

      // After migration, data should be in bookDataStore
      const migratedData = await get<ArrayBuffer>("old-book", bookDataStore);
      expect(migratedData).toBeInstanceOf(ArrayBuffer);
      expect(migratedData!.byteLength).toBe(16);

      // And the bookStore record should no longer have inline data
      const metaRecord = await get<Record<string, unknown>>("old-book", bookStore);
      expect(metaRecord).toBeDefined();
      expect(metaRecord!.data).toBeUndefined();
      expect(metaRecord!.id).toBe("old-book");
      expect(metaRecord!.title).toBe("Old Book");
    });

    it("is idempotent — second call uses bookDataStore directly", async () => {
      const suffix = `test-${++testCounter}-${Date.now()}`;
      const bookStore = createStore(`book-db-${suffix}`, "books");
      const bookDataStore = createStore(`book-data-db-${suffix}`, "book-data");

      const oldRecord = {
        id: "old-book-2",
        title: "Old Book 2",
        author: "Author",
        coverImage: null,
        data: new ArrayBuffer(8),
      };
      await set("old-book-2", oldRecord, bookStore);

      const bookLayer = Layer.succeed(BookService, makeBookService({ bookStore, bookDataStore }));
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));

      // First call triggers migration
      await run(BookService.pipe(Effect.andThen((s) => s.getBookData("old-book-2"))));
      // Second call should work from bookDataStore
      const data = await run(BookService.pipe(Effect.andThen((s) => s.getBookData("old-book-2"))));
      expect(data).toBeInstanceOf(ArrayBuffer);
      expect(data.byteLength).toBe(8);
    });

    it("getBooks still decodes old-format records (extra data field is ignored)", async () => {
      const suffix = `test-${++testCounter}-${Date.now()}`;
      const bookStore = createStore(`book-db-${suffix}`, "books");
      const bookDataStore = createStore(`book-data-db-${suffix}`, "book-data");

      const oldRecord = {
        id: "old-book-3",
        title: "Old Book 3",
        author: "Author",
        coverImage: null,
        data: new ArrayBuffer(8),
      };
      await set("old-book-3", oldRecord, bookStore);

      const bookLayer = Layer.succeed(BookService, makeBookService({ bookStore, bookDataStore }));
      const run = <A, E>(e: Effect.Effect<A, E, BookService>) =>
        Effect.runPromise(Effect.provide(e, bookLayer));

      const books = await run(BookService.pipe(Effect.andThen((s) => s.getBooks())));
      expect(books).toHaveLength(1);
      expect(books[0].id).toBe("old-book-3");
      expect(books[0].title).toBe("Old Book 3");
    });
  });
});

describe("ReadingPositionService", () => {
  describe("savePosition + getPosition", () => {
    it("saves and retrieves a reading position", async () => {
      const { positionLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, ReadingPositionService>) =>
        Effect.runPromise(Effect.provide(e, positionLayer));
      await run(
        ReadingPositionService.pipe(
          Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/4)")),
        ),
      );
      const pos = await run(
        ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition("book-1"))),
      );
      expect(pos).toBe("epubcfi(/6/4)");
    });

    it("returns null for missing position", async () => {
      const { positionLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, ReadingPositionService>) =>
        Effect.runPromise(Effect.provide(e, positionLayer));
      const pos = await run(
        ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition("no-book"))),
      );
      expect(pos).toBeNull();
    });

    it("overwrites an existing position", async () => {
      const { positionLayer } = makeTestLayer();
      const run = <A, E>(e: Effect.Effect<A, E, ReadingPositionService>) =>
        Effect.runPromise(Effect.provide(e, positionLayer));
      await run(
        ReadingPositionService.pipe(
          Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/4)")),
        ),
      );
      await run(
        ReadingPositionService.pipe(
          Effect.andThen((s) => s.savePosition("book-1", "epubcfi(/6/8)")),
        ),
      );
      const pos = await run(
        ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition("book-1"))),
      );
      expect(pos).toBe("epubcfi(/6/8)");
    });
  });
});
