import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Highlight } from "~/lib/stores/annotations-store";
import type { BookMeta } from "~/lib/stores/book-store";
import type { BookUploadFile } from "~/lib/themis/books/books-slice";

const mocks = vi.hoisted(() => ({
  findByFileHash: vi.fn(),
  saveBook: vi.fn(),
  updateBookMeta: vi.fn(),
  deleteBook: vi.fn(),
  getBookData: vi.fn(),
  getBooks: vi.fn(),
  parseEpub: vi.fn(),
  parsePdf: vi.fn(),
  getHighlightsByBook: vi.fn(),
  deleteHighlight: vi.fn(),
}));

vi.mock("~/lib/stores/book-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/book-store")>();
  return { ...actual, BookService: { ...actual.BookService, ...mocks } };
});
vi.mock("~/lib/stores/annotations-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/annotations-store")>();
  return {
    ...actual,
    AnnotationService: {
      ...actual.AnnotationService,
      getHighlightsByBook: mocks.getHighlightsByBook,
      deleteHighlight: mocks.deleteHighlight,
    },
  };
});
vi.mock("~/lib/epub/epub-service", () => ({ parseEpub: mocks.parseEpub }));
vi.mock("~/lib/pdf/pdf-service", () => ({ parsePdf: mocks.parsePdf }));

import {
  deletePersistedBook,
  downloadBookForOpen,
  persistUploadedBook,
} from "~/lib/themis/books/books-sagas";

function makeFile(name = "book.epub"): BookUploadFile {
  const data = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer;
  return { name, arrayBuffer: async () => data };
}

describe("book mutation persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses, hashes, and saves a new upload", async () => {
    mocks.findByFileHash.mockResolvedValueOnce(null);
    mocks.parseEpub.mockResolvedValueOnce({ title: "Parsed", author: "Author", coverImage: null });
    mocks.saveBook.mockResolvedValueOnce(undefined);

    const book = await persistUploadedBook(makeFile());

    expect(mocks.parseEpub).toHaveBeenCalledOnce();
    expect(mocks.saveBook).toHaveBeenCalledOnce();
    expect(book).toMatchObject({ title: "Parsed", author: "Author", format: "epub" });
    expect(book.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reuses a duplicate hash without parsing or saving", async () => {
    const existing: BookMeta = {
      id: "existing",
      title: "Existing",
      author: "Author",
      coverImage: null,
      format: "epub",
    };
    mocks.findByFileHash.mockResolvedValueOnce(existing);

    await expect(persistUploadedBook(makeFile())).resolves.toBe(existing);
    expect(mocks.parseEpub).not.toHaveBeenCalled();
    expect(mocks.saveBook).not.toHaveBeenCalled();
  });

  it("rejects failed parsing", async () => {
    mocks.findByFileHash.mockResolvedValueOnce(null);
    mocks.parseEpub.mockRejectedValueOnce(new Error("invalid epub"));
    await expect(persistUploadedBook(makeFile())).rejects.toThrow("invalid epub");
  });

  it("deletes highlights before deleting the book", async () => {
    const highlights = ["one", "two"].map(
      (id): Highlight => ({
        id,
        bookId: "book-1",
        cfiRange: id,
        text: id,
        color: "yellow",
        createdAt: 1,
      }),
    );
    const operations: string[] = [];
    mocks.getHighlightsByBook.mockResolvedValueOnce(highlights);
    mocks.deleteHighlight.mockImplementation(async (id: string) => {
      operations.push(`highlight:${id}`);
    });
    mocks.deleteBook.mockImplementationOnce(async (id: string) => {
      operations.push(`book:${id}`);
    });

    await deletePersistedBook("book-1");
    expect(operations.slice(0, 2).sort()).toEqual(["highlight:one", "highlight:two"]);
    expect(operations[2]).toBe("book:book-1");
  });

  it("downloads and returns refreshed local metadata", async () => {
    const downloaded: BookMeta = {
      id: "book-1",
      title: "Downloaded",
      author: "Author",
      coverImage: null,
      format: "epub",
      hasLocalFile: true,
    };
    mocks.getBookData.mockResolvedValueOnce(new ArrayBuffer(4));
    mocks.getBooks.mockResolvedValueOnce([downloaded]);

    await expect(downloadBookForOpen("book-1")).resolves.toBe(downloaded);
  });
});
