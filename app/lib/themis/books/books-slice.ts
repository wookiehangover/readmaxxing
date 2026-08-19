import {
  createCollection,
  removeItem,
  upsertItem,
  type Collection,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { BookMeta } from "~/lib/stores/book-store";

export interface BooksState {
  collection: Collection<BookMeta, "id">;
  loading: boolean;
  error: string | null;
}

export const hydrateBooks = createAction("books/hydrate");
export const booksHydrated = createAction<[books: BookMeta[]]>("books/hydrated");
export const bookAdded = createAction<[book: BookMeta]>("books/bookAdded");
export const bookUpdated = createAction<[book: BookMeta]>("books/bookUpdated");
export const bookDeleted = createAction<[bookId: string]>("books/bookDeleted");
export const booksHydrateFailed = createAction<[error: string]>("books/hydrateFailed");

export const booksInitialState: BooksState = {
  collection: createCollection<BookMeta, "id">("id"),
  loading: false,
  error: null,
};

const reducer = createReducer<BooksState>(booksInitialState);

reducer.with(hydrateBooks, (state) => ({ ...state, loading: true, error: null }));
reducer.with(booksHydrated, (state, { payload: [books] }) => ({
  ...state,
  collection: createCollection<BookMeta, "id">("id", books),
  loading: false,
  error: null,
}));
reducer.with(bookAdded, (state, { payload: [book] }) => ({
  ...state,
  collection: upsertItem(state.collection, book),
}));
reducer.with(bookUpdated, (state, { payload: [book] }) => ({
  ...state,
  collection: upsertItem(state.collection, book),
}));
reducer.with(bookDeleted, (state, { payload: [bookId] }) => ({
  ...state,
  collection: removeItem(state.collection, bookId),
}));
reducer.with(booksHydrateFailed, (state, { payload: [error] }) => ({
  ...state,
  loading: false,
  error,
}));

export const booksReducer = reducer;
