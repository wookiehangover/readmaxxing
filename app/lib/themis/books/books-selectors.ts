import type { ReactStore } from "@augmentcode/themis/react-store";
import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";

import { booksReducer, type BooksState } from "~/lib/themis/books/books-slice";

type BooksStore = ReactStore<{ books: BooksState }, { books: typeof booksReducer }>;

export function createBooksSelectors(store: BooksStore) {
  return {
    selectAllBooks: store.createSelector((state) => getItems(state.books.collection)),
    selectBookById: store.createSelector((state, bookId: string) =>
      getItem(state.books.collection, bookId),
    ),
    selectBooksLoading: store.createSelector((state) => state.books.loading),
    selectBooksError: store.createSelector((state) => state.books.error),
  };
}
