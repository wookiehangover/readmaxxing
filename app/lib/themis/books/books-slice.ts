import {
  createCollection,
  removeItem,
  upsertItem,
  type Collection,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { BookMeta } from "~/lib/stores/book-store";

export interface BookUploadFile {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type BookAddedCallback = (book: BookMeta) => void;
export type BookDeletedCallback = (bookId: string) => void;

export interface BooksState {
  collection: Collection<BookMeta, "id">;
  loading: boolean;
  uploading: boolean;
  deletingBookIds: string[];
  error: string | null;
}

export const hydrateBooks = createAction("books/hydrate");
export const booksHydrated = createAction<[books: BookMeta[]]>("books/hydrated");
export const bookAdded = createAction<[book: BookMeta]>("books/bookAdded");
export const bookUpdated = createAction<[book: BookMeta]>("books/bookUpdated");
export const bookDeleted = createAction<[bookId: string]>("books/bookDeleted");
export const booksHydrateFailed = createAction<[error: string]>("books/hydrateFailed");
export const uploadBooksRequested =
  createAction<[files: BookUploadFile[], onBookAdded?: BookAddedCallback]>("books/uploadRequested");
export const booksUploadCompleted = createAction("books/uploadCompleted");
export const booksUploadFailed = createAction<[error: string]>("books/uploadFailed");
export const deleteBookRequested =
  createAction<[bookId: string, onBookDeleted?: BookDeletedCallback]>("books/deleteRequested");
export const bookDeletionCompleted = createAction<[bookId: string]>("books/deleteCompleted");
export const bookDeletionFailed =
  createAction<[bookId: string, error: string]>("books/deleteFailed");

export const booksInitialState: BooksState = {
  collection: createCollection<BookMeta, "id">("id"),
  loading: false,
  uploading: false,
  deletingBookIds: [],
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
reducer.with(uploadBooksRequested, (state) => ({ ...state, uploading: true, error: null }));
reducer.with(booksUploadCompleted, (state) => ({ ...state, uploading: false }));
reducer.with(booksUploadFailed, (state, { payload: [error] }) => ({
  ...state,
  uploading: false,
  error,
}));
reducer.with(deleteBookRequested, (state, { payload: [bookId] }) => ({
  ...state,
  deletingBookIds: state.deletingBookIds.includes(bookId)
    ? state.deletingBookIds
    : [...state.deletingBookIds, bookId],
  error: null,
}));
reducer.with(bookDeletionCompleted, (state, { payload: [bookId] }) => ({
  ...state,
  deletingBookIds: state.deletingBookIds.filter((id) => id !== bookId),
}));
reducer.with(bookDeletionFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  deletingBookIds: state.deletingBookIds.filter((id) => id !== bookId),
  error,
}));

export const booksReducer = reducer;
