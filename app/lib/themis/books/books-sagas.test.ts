import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookMeta } from "~/lib/stores/book-store";
import type { BookUploadFile } from "~/lib/themis/books/books-slice";

const mocks = vi.hoisted(() => ({
  getBooks: vi.fn(),
  getBookData: vi.fn(),
  findByFileHash: vi.fn(),
  saveBook: vi.fn(),
  updateBookMeta: vi.fn(),
  deleteBook: vi.fn(),
  getHighlightsByBook: vi.fn(),
  deleteHighlight: vi.fn(),
  parseEpub: vi.fn(),
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
vi.mock("~/lib/onboarding/adopt-demo", () => ({ persistAdoptedDemoContent: vi.fn() }));
vi.mock("~/lib/onboarding/demo-seed", () => ({
  completeDemoOnboarding: vi.fn(),
  fetchDemoEpub: vi.fn(),
  isFirstVisit: vi.fn().mockResolvedValue(false),
  provisionDemoContent: vi.fn(),
}));

import { booksSaga } from "~/lib/themis/books/books-sagas";
import {
  bookAdded,
  deleteBookRequested,
  downloadBookForOpenRequested,
  hydrateBooks,
  loadBookDataRequested,
  updateBookMetadataRequested,
  uploadBooksRequested,
} from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function makeBook(id: string): BookMeta {
  return { id, title: `Book ${id}`, author: "Author", coverImage: null, format: "epub" };
}

function makeFile(): BookUploadFile {
  return { name: "book.epub", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(booksSaga);
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHighlightsByBook.mockResolvedValue([]);
});

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

describe("booksSaga", () => {
  it("hydrates books from persistence", async () => {
    const books = [makeBook("one"), makeBook("two")];
    mocks.getBooks.mockResolvedValueOnce(books);
    const store = startStore();

    store.dispatch(hydrateBooks());

    await vi.waitFor(() =>
      expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual(books),
    );
  });

  it("stores a hydrate failure", async () => {
    mocks.getBooks.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();
    store.dispatch(hydrateBooks());
    await vi.waitFor(() => expect(store.state.books.error).toBe("IDB unavailable"));
  });

  it("loads reader binary without storing it in Redux", async () => {
    const data = new ArrayBuffer(8);
    const completed = vi.fn();
    mocks.getBookData.mockResolvedValueOnce(data);
    const store = startStore();

    store.dispatch(loadBookDataRequested("book-1", completed, vi.fn()));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(data));
    expect(JSON.stringify(store.state)).not.toContain("ArrayBuffer");
  });

  it("persists an upload before adding it to the collection", async () => {
    mocks.findByFileHash.mockResolvedValueOnce(null);
    mocks.parseEpub.mockResolvedValueOnce({
      title: "Uploaded",
      author: "Author",
      coverImage: null,
    });
    mocks.saveBook.mockResolvedValueOnce(undefined);
    const completed = vi.fn();
    const store = startStore();

    store.dispatch(uploadBooksRequested([makeFile()], completed));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce());
    const [book] = completed.mock.calls[0];
    expect(mocks.saveBook).toHaveBeenCalledOnce();
    expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toEqual(book);
  });

  it("keeps failed uploads out of the collection", async () => {
    mocks.findByFileHash.mockResolvedValueOnce(null);
    mocks.parseEpub.mockRejectedValueOnce(new Error("parse failed"));
    const failed = vi.fn();
    const store = startStore();

    store.dispatch(uploadBooksRequested([makeFile()], undefined, undefined, failed));

    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith("parse failed"));
    expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual([]);
  });

  it("persists metadata before updating the existing collection entry", async () => {
    const original = makeBook("edit-me");
    const updated = { ...original, title: "Edited title" };
    const persisted = { ...updated, updatedAt: 1_234 };
    const completed = vi.fn();
    const store = startStore();
    store.dispatch(bookAdded(original));
    mocks.updateBookMeta.mockImplementationOnce(async () => {
      expect(store.booksSelectors.selectBookById.select(store.state, original.id)).toEqual(
        original,
      );
      return persisted;
    });

    store.dispatch(updateBookMetadataRequested(updated, "update", completed, vi.fn()));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(persisted));
    expect(mocks.updateBookMeta).toHaveBeenCalledWith(updated);
    const selected = store.booksSelectors.selectBookById.select(store.state, updated.id);
    expect(completed.mock.calls[0]?.[0]).toBe(persisted);
    expect(selected).toEqual(persisted);
    expect(selected?.updatedAt).toBe(persisted.updatedAt);
  });

  it("persists restored metadata before adding the missing book to the collection", async () => {
    const restored = makeBook("restore-me");
    const persisted = { ...restored, updatedAt: 5_678 };
    const completed = vi.fn();
    const store = startStore();
    mocks.updateBookMeta.mockImplementationOnce(async () => {
      expect(store.booksSelectors.selectBookById.select(store.state, restored.id)).toBeUndefined();
      return persisted;
    });

    store.dispatch(updateBookMetadataRequested(restored, "restore", completed, vi.fn()));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(persisted));
    expect(mocks.updateBookMeta).toHaveBeenCalledWith(restored);
    const selected = store.booksSelectors.selectBookById.select(store.state, restored.id);
    expect(completed.mock.calls[0]?.[0]).toBe(persisted);
    expect(selected).toEqual(persisted);
    expect(selected?.updatedAt).toBe(persisted.updatedAt);
  });

  it("deletes persisted data before removing collection metadata", async () => {
    const book = makeBook("delete-me");
    mocks.deleteBook.mockResolvedValueOnce(undefined);
    const completed = vi.fn();
    const store = startStore();
    store.dispatch(bookAdded(book));

    store.dispatch(deleteBookRequested(book.id, completed));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(book.id));
    expect(mocks.deleteBook).toHaveBeenCalledWith(book.id);
    expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toBeUndefined();
  });

  it("downloads before opening and upserts refreshed metadata", async () => {
    const remote = { ...makeBook("remote"), remoteFileUrl: "remote", hasLocalFile: false };
    const downloaded = { ...remote, hasLocalFile: true };
    mocks.getBookData.mockResolvedValueOnce(new ArrayBuffer(4));
    mocks.getBooks.mockResolvedValueOnce([downloaded]);
    const completed = vi.fn();
    const store = startStore();
    store.dispatch(bookAdded(remote));

    store.dispatch(downloadBookForOpenRequested(remote.id, completed, vi.fn()));

    await vi.waitFor(() => expect(completed).toHaveBeenCalledWith(downloaded));
    expect(store.booksSelectors.selectBookById.select(store.state, remote.id)).toEqual(downloaded);
  });
});
