import { ReactStore } from "@augmentcode/themis/react-store";

import { createBooksSelectors } from "~/lib/themis/books/books-selectors";
import { booksReducer } from "~/lib/themis/books/books-slice";

export function createAppStore() {
  const store = new ReactStore({ books: booksReducer });
  return Object.assign(store, { booksSelectors: createBooksSelectors(store) });
}

export type AppStore = ReturnType<typeof createAppStore>;
