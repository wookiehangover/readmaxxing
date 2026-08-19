import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { EpubParseError, StorageError } from "~/lib/errors";
import { EpubService } from "~/lib/epub/epub-service";
import { PdfService } from "~/lib/pdf/pdf-service";
import { AnnotationService, type Highlight } from "~/lib/stores/annotations-store";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import {
  deletePersistedBookEffect,
  downloadBookForOpenEffect,
  persistUploadedBookEffect,
} from "~/lib/themis/books/books-sagas";
import type { BookUploadFile } from "~/lib/themis/books/books-slice";

function makeFile(name = "book.epub"): BookUploadFile {
  const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
  return { name, arrayBuffer: async () => data };
}

function uploadLayer(options: {
  existing?: BookMeta | null;
  parseFailure?: boolean;
  saveFailure?: boolean;
}) {
  const findByFileHash = vi.fn(() => Effect.succeed(options.existing ?? null));
  const saveBook = vi.fn((_book: BookMeta, _data: ArrayBuffer) =>
    options.saveFailure
      ? Effect.fail(new StorageError({ operation: "saveBook" }))
      : Effect.succeed(undefined),
  );
  const parseEpub = vi.fn(() =>
    options.parseFailure
      ? Effect.fail(new EpubParseError({ operation: "parseEpub" }))
      : Effect.succeed({ title: "Parsed", author: "Author", coverImage: null }),
  );
  const layer = Layer.mergeAll(
    Layer.succeed(BookService, { findByFileHash, saveBook } as unknown as BookService["Type"]),
    Layer.succeed(EpubService, { parseEpub }),
    Layer.succeed(PdfService, {
      parsePdf: () =>
        Effect.succeed({ title: "PDF", author: "Author", pageCount: 1, coverImage: null }),
    }),
  );
  return { findByFileHash, saveBook, parseEpub, layer };
}

describe("book mutation effects", () => {
  it("parses, hashes, and saves a new upload", async () => {
    const { findByFileHash, saveBook, parseEpub, layer } = uploadLayer({});

    const book = await Effect.runPromise(
      Effect.provide(persistUploadedBookEffect(makeFile()), layer),
    );

    expect(findByFileHash).toHaveBeenCalledOnce();
    expect(parseEpub).toHaveBeenCalledOnce();
    expect(saveBook).toHaveBeenCalledOnce();
    expect(book).toMatchObject({ title: "Parsed", author: "Author", format: "epub" });
    expect(book.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(saveBook.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
  });

  it("reuses a duplicate hash without parsing or saving", async () => {
    const existing: BookMeta = {
      id: "existing",
      title: "Existing",
      author: "Author",
      coverImage: null,
      format: "epub",
      fileHash: "same-hash",
    };
    const { saveBook, parseEpub, layer } = uploadLayer({ existing });

    const book = await Effect.runPromise(
      Effect.provide(persistUploadedBookEffect(makeFile()), layer),
    );

    expect(book).toBe(existing);
    expect(parseEpub).not.toHaveBeenCalled();
    expect(saveBook).not.toHaveBeenCalled();
  });

  it.each([
    ["parse", { parseFailure: true }],
    ["save", { saveFailure: true }],
  ] as const)("fails the upload when %s fails", async (_operation, options) => {
    const { layer } = uploadLayer(options);

    await expect(
      Effect.runPromise(Effect.provide(persistUploadedBookEffect(makeFile()), layer)),
    ).rejects.toBeDefined();
  });

  it("deletes highlights before deleting the book", async () => {
    const operations: string[] = [];
    const highlights: Highlight[] = ["one", "two"].map((id) => ({
      id,
      bookId: "book-1",
      cfiRange: `range-${id}`,
      text: id,
      color: "yellow",
      createdAt: 1,
    }));
    const annotationLayer = Layer.succeed(AnnotationService, {
      getHighlightsByBook: () => Effect.succeed(highlights),
      deleteHighlight: (id: string) =>
        Effect.sync(() => {
          operations.push(`highlight:${id}`);
        }),
    } as unknown as AnnotationService["Type"]);
    const bookLayer = Layer.succeed(BookService, {
      deleteBook: (id: string) =>
        Effect.sync(() => {
          operations.push(`book:${id}`);
        }),
    } as unknown as BookService["Type"]);

    await Effect.runPromise(
      Effect.provide(deletePersistedBookEffect("book-1"), Layer.merge(annotationLayer, bookLayer)),
    );

    expect(operations).toEqual(["highlight:one", "highlight:two", "book:book-1"]);
  });

  it("downloads through BookService and returns refreshed local metadata", async () => {
    const operations: string[] = [];
    const downloaded: BookMeta = {
      id: "book-1",
      title: "Downloaded",
      author: "Author",
      coverImage: null,
      format: "epub",
      hasLocalFile: true,
    };
    const layer = Layer.succeed(BookService, {
      getBookData: () =>
        Effect.sync(() => {
          operations.push("data");
          return new ArrayBuffer(4);
        }),
      getBooks: () =>
        Effect.sync(() => {
          operations.push("books");
          return [downloaded];
        }),
    } as unknown as BookService["Type"]);

    const result = await Effect.runPromise(
      Effect.provide(downloadBookForOpenEffect("book-1"), layer),
    );

    expect(operations).toEqual(["data", "books"]);
    expect(result).toBe(downloaded);
    expect(result).not.toHaveProperty("data");
  });
});
