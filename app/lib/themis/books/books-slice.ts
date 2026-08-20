import {
  createCollection,
  removeItem,
  upsertItem,
  type Collection,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

import type { TaggedError } from "~/lib/errors";
import type { BookMeta } from "~/lib/stores/book-store";

export interface BookUploadFile {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface SharedBookImportRequest {
  shareId: string;
  title: string;
  author: string;
  format: "epub" | "pdf";
}

export interface BookReplacementRequest {
  bookId: string;
  file: BookUploadFile;
  remoteCoverUrl?: string;
  syncActive: boolean;
  reloadBookFiles: (bookId: string) => Promise<void>;
}

export type BookAddedCallback = (book: BookMeta) => void;
export type BookDeletedCallback = (bookId: string) => void;
export type BookUploadCompletedCallback = () => void;
export type BookUploadFailedCallback = (error: string) => void;
export type BookMutationCompletedCallback = (book: BookMeta) => void | Promise<void>;
export type BookMutationFailedCallback = (error: string) => void;
export type BookDataLoadedCallback = (data: ArrayBuffer) => void;
export type BookMetadataMutation = "update" | "restore";
export type DemoAdoptionCompletedCallback = (result: {
  bookId: string;
  sessionId: string;
}) => void | Promise<void>;

export interface BooksState {
  collection: Collection<BookMeta, "id">;
  initialHydrationComplete: boolean;
  loading: boolean;
  uploading: boolean;
  deletingBookIds: string[];
  downloadingBookIds: string[];
  downloadErrors: Record<string, TaggedError>;
  seededDemoBookId: string | null;
  error: TaggedError | null;
}

export const hydrateBooks = createAction("books/hydrate");
export const booksHydrated = createAction<[books: BookMeta[]]>("books/hydrated");
export const bookAdded = createAction<[book: BookMeta]>("books/bookAdded");
export const bookUpdated = createAction<[book: BookMeta]>("books/bookUpdated");
export const bookDeleted = createAction<[bookId: string]>("books/bookDeleted");
export const booksHydrateFailed = createAction<[error: TaggedError]>("books/hydrateFailed");
export const uploadBooksRequested =
  createAction<
    [
      files: BookUploadFile[],
      onBookAdded?: BookAddedCallback,
      onUploadCompleted?: BookUploadCompletedCallback,
      onUploadFailed?: BookUploadFailedCallback,
    ]
  >("books/uploadRequested");
export const booksUploadCompleted = createAction("books/uploadCompleted");
export const booksUploadFailed = createAction<[error: TaggedError]>("books/uploadFailed");
export const bookMutationFailed = createAction<[error: TaggedError]>("books/mutationFailed");
export const importSharedBookRequested = createAction<
  [
    request: SharedBookImportRequest,
    onCompleted: BookMutationCompletedCallback,
    onFailed: BookMutationFailedCallback,
  ]
>("books/importSharedRequested");
export const replaceBookFileRequested = createAction<
  [
    request: BookReplacementRequest,
    onCompleted: BookMutationCompletedCallback,
    onFailed: BookMutationFailedCallback,
  ]
>("books/replaceFileRequested");
export const seedDemoBookRequested = createAction("books/seedDemoRequested");
export const demoBookSeeded = createAction<[bookId: string]>("books/demoSeeded");
export const adoptDemoBookRequested = createAction<
  [userId: string, onCompleted: DemoAdoptionCompletedCallback, onFailed: BookMutationFailedCallback]
>("books/adoptDemoRequested");
export const deleteBookRequested =
  createAction<[bookId: string, onBookDeleted?: BookDeletedCallback]>("books/deleteRequested");
export const bookDeletionCompleted = createAction<[bookId: string]>("books/deleteCompleted");
export const bookDeletionFailed =
  createAction<[bookId: string, error: TaggedError]>("books/deleteFailed");
export const downloadBookForOpenRequested = createAction<
  [bookId: string, onCompleted: BookMutationCompletedCallback, onFailed: BookMutationFailedCallback]
>("books/downloadForOpenRequested");
export const bookDownloadCompleted = createAction<[bookId: string]>("books/downloadCompleted");
export const bookDownloadFailed =
  createAction<[bookId: string, error: TaggedError]>("books/downloadFailed");
export const loadBookDataRequested =
  createAction<
    [bookId: string, onCompleted: BookDataLoadedCallback, onFailed: BookMutationFailedCallback]
  >("books/loadDataRequested");
export const updateBookMetadataRequested = createAction<
  [
    book: BookMeta,
    mutation: BookMetadataMutation,
    onCompleted: BookMutationCompletedCallback,
    onFailed: BookMutationFailedCallback,
  ]
>("books/updateMetadataRequested");

export const booksInitialState: BooksState = {
  collection: createCollection<BookMeta, "id">("id"),
  initialHydrationComplete: false,
  loading: false,
  uploading: false,
  deletingBookIds: [],
  downloadingBookIds: [],
  downloadErrors: {},
  seededDemoBookId: null,
  error: null,
};

const reducer = createReducer<BooksState>(booksInitialState);

reducer.with(hydrateBooks, (state) => ({
  ...state,
  loading: !state.initialHydrationComplete,
  error: null,
}));
reducer.with(booksHydrated, (state, { payload: [books] }) => ({
  ...state,
  collection: createCollection<BookMeta, "id">("id", books),
  initialHydrationComplete: true,
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
  initialHydrationComplete: true,
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
reducer.with(bookMutationFailed, (state, { payload: [error] }) => ({ ...state, error }));
reducer.with(demoBookSeeded, (state, { payload: [bookId] }) => ({
  ...state,
  seededDemoBookId: bookId,
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
reducer.with(downloadBookForOpenRequested, (state, { payload: [bookId] }) => {
  const { [bookId]: _, ...downloadErrors } = state.downloadErrors;
  return {
    ...state,
    downloadingBookIds: state.downloadingBookIds.includes(bookId)
      ? state.downloadingBookIds
      : [...state.downloadingBookIds, bookId],
    downloadErrors,
  };
});
reducer.with(bookDownloadCompleted, (state, { payload: [bookId] }) => ({
  ...state,
  downloadingBookIds: state.downloadingBookIds.filter((id) => id !== bookId),
}));
reducer.with(bookDownloadFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  downloadingBookIds: state.downloadingBookIds.filter((id) => id !== bookId),
  downloadErrors: { ...state.downloadErrors, [bookId]: error },
}));

export const booksReducer = reducer;
