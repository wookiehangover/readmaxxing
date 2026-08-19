import { afterEach, describe, expect, it, vi } from "vitest";

import type { BookMeta } from "~/lib/stores/book-store";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/effect-runtime", () => ({
  AppRuntime: { runPromise: mocks.runPromise },
}));

import { booksSaga } from "~/lib/themis/books/books-sagas";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function makeBook(id: string): BookMeta {
  return { id, title: `Book ${id}`, author: "Author", coverImage: null, format: "epub" };
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
});
