import { afterEach, describe, expect, it, vi } from "vitest";
import { getItem } from "@augmentcode/themis/utils/collections/collection-utils";

import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));

import { booksSaga } from "~/lib/themis/books/books-sagas";
import {
  bookAdded,
  deleteBookRequested,
  downloadBookForOpenRequested,
  hydrateBooks,
  uploadBooksRequested,
  type BookUploadFile,
} from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function makeBook(id: string): BookMeta {
  return { id, title: `Book ${id}`, author: "Author", coverImage: null, format: "epub" };
}

function makeFile(name = "book.epub"): BookUploadFile {
  return { name, arrayBuffer: async () => new ArrayBuffer(4) };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(booksSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  mocks.runPromise.mockReset();
});

describe("booksSaga", () => {
  it("hydrates an empty IDB result", async () => {
    mocks.runPromise.mockResolvedValueOnce([]);
    const store = startStore();

    store.dispatch(hydrateBooks());

    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(store.booksSelectors.selectBooksLoading.select(store.state)).toBe(false),
    );
    expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual([]);
  });

  it("hydrates several books from IDB", async () => {
    const books = [makeBook("one"), makeBook("two"), makeBook("three")];
    mocks.runPromise.mockResolvedValueOnce(books);
    const store = startStore();

    store.dispatch(hydrateBooks());

    await vi.waitFor(() =>
      expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual(books),
    );
    expect(store.booksSelectors.selectBookById.select(store.state, "two")).toEqual(books[1]);
  });

  it("stores a hydrate failure", async () => {
    mocks.runPromise.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();

    store.dispatch(hydrateBooks());

    await vi.waitFor(() =>
      expect(store.booksSelectors.selectBooksError.select(store.state)).toBe("IDB unavailable"),
    );
    expect(store.booksSelectors.selectBooksLoading.select(store.state)).toBe(false);
    expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual([]);
  });

  it("adds a persisted upload before invoking its UI callback", async () => {
    const book = makeBook("uploaded");
    const store = startStore();
    const onBookAdded = vi.fn(() => {
      expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toEqual(book);
    });
    const onUploadCompleted = vi.fn();
    mocks.runPromise.mockResolvedValueOnce(book);

    store.dispatch(uploadBooksRequested([makeFile()], onBookAdded, onUploadCompleted));

    await vi.waitFor(() =>
      expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toEqual(book),
    );
    await vi.waitFor(() => expect(onBookAdded).toHaveBeenCalledWith(book));
    expect(onUploadCompleted).toHaveBeenCalledOnce();
    expect(store.state.books.uploading).toBe(false);
    expect(store.state.books.error).toBeNull();
    expect(getItem(store.state.books.collection, book.id)).not.toHaveProperty("data");
  });

  it("keeps an upload out of the collection when persistence fails", async () => {
    mocks.runPromise.mockRejectedValueOnce(new Error("parse failed"));
    const store = startStore();
    const onUploadFailed = vi.fn();

    store.dispatch(uploadBooksRequested([makeFile()], undefined, undefined, onUploadFailed));

    await vi.waitFor(() => expect(store.state.books.error).toBe("parse failed"));
    expect(onUploadFailed).toHaveBeenCalledWith("parse failed");
    expect(store.state.books.uploading).toBe(false);
    expect(store.booksSelectors.selectAllBooks.select(store.state)).toEqual([]);
  });

  it("removes a book only after persisted deletion succeeds", async () => {
    const book = makeBook("delete-me");
    const onBookDeleted = vi.fn();
    mocks.runPromise.mockResolvedValueOnce(undefined);
    const store = startStore();
    store.dispatch(bookAdded(book));

    store.dispatch(deleteBookRequested(book.id, onBookDeleted));

    await vi.waitFor(() =>
      expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toBeUndefined(),
    );
    await vi.waitFor(() => expect(onBookDeleted).toHaveBeenCalledWith(book.id));
    expect(store.state.books.deletingBookIds).toEqual([]);
  });

  it("keeps a book in the collection when persisted deletion fails", async () => {
    const book = makeBook("keep-me");
    mocks.runPromise.mockRejectedValueOnce(new Error("delete failed"));
    const store = startStore();
    store.dispatch(bookAdded(book));

    store.dispatch(deleteBookRequested(book.id));

    await vi.waitFor(() => expect(store.state.books.error).toBe("delete failed"));
    expect(store.booksSelectors.selectBookById.select(store.state, book.id)).toEqual(book);
    expect(store.state.books.deletingBookIds).toEqual([]);
  });

  it("upserts downloaded metadata before opening the book", async () => {
    const remoteBook = { ...makeBook("remote"), remoteFileUrl: "remote", hasLocalFile: false };
    const downloadedBook = { ...remoteBook, hasLocalFile: true };
    const store = startStore();
    const onCompleted = vi.fn(() => {
      expect(store.booksSelectors.selectBookById.select(store.state, remoteBook.id)).toEqual(
        downloadedBook,
      );
    });
    mocks.runPromise.mockResolvedValueOnce(downloadedBook);
    store.dispatch(bookAdded(remoteBook));

    store.dispatch(downloadBookForOpenRequested(remoteBook.id, onCompleted, vi.fn()));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(downloadedBook));
    expect(store.state.books.downloadingBookIds).toEqual([]);
    expect(store.state.books.downloadErrors).toEqual({});
    expect(getItem(store.state.books.collection, remoteBook.id)).not.toHaveProperty("data");
  });

  it("stores a per-book download failure and does not open", async () => {
    const store = startStore();
    const onCompleted = vi.fn();
    const onFailed = vi.fn();
    mocks.runPromise.mockRejectedValueOnce(new Error("download failed"));

    store.dispatch(downloadBookForOpenRequested("remote", onCompleted, onFailed));

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith("download failed"));
    expect(onCompleted).not.toHaveBeenCalled();
    expect(store.state.books.downloadingBookIds).toEqual([]);
    expect(store.state.books.downloadErrors).toEqual({ remote: "download failed" });
  });
});
