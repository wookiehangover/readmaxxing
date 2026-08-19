import { Effect } from "effect";
import { call, put, takeEvery, takeLatest } from "typed-redux-saga";

import { computeFileHash } from "~/lib/book-hash";
import { AppRuntime } from "~/lib/effect-runtime";
import { parseEpubEffect } from "~/lib/epub/epub-service";
import { parsePdfEffect } from "~/lib/pdf/pdf-service";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService, type BookFormat, type BookMeta } from "~/lib/stores/book-store";
import {
  bookAdded,
  bookDeleted,
  bookDownloadCompleted,
  bookDownloadFailed,
  bookUpdated,
  bookDeletionCompleted,
  bookDeletionFailed,
  booksHydrateFailed,
  booksHydrated,
  booksUploadCompleted,
  booksUploadFailed,
  deleteBookRequested,
  downloadBookForOpenRequested,
  hydrateBooks,
  uploadBooksRequested,
  type BookAddedCallback,
  type BookDeletedCallback,
  type BookDownloadCompletedCallback,
  type BookDownloadFailedCallback,
  type BookUploadCompletedCallback,
  type BookUploadFailedCallback,
  type BookUploadFile,
} from "~/lib/themis/books/books-slice";

async function loadBooks() {
  return AppRuntime.runPromise(BookService.pipe(Effect.andThen((service) => service.getBooks())));
}

export function persistUploadedBookEffect(file: BookUploadFile) {
  return Effect.gen(function* () {
    const arrayBuffer = yield* Effect.promise(() => file.arrayBuffer());
    const fileHash = yield* Effect.promise(() => computeFileHash(arrayBuffer));
    const bookService = yield* BookService;
    const existing = yield* bookService.findByFileHash(fileHash);
    if (existing) return existing;

    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const format: BookFormat = isPdf ? "pdf" : "epub";
    const metadata = isPdf
      ? yield* parsePdfEffect(arrayBuffer, file.name)
      : yield* parseEpubEffect(arrayBuffer);
    const book: BookMeta = {
      id: crypto.randomUUID(),
      title: metadata.title,
      author: metadata.author,
      coverImage: metadata.coverImage,
      format,
      fileHash,
    };

    yield* bookService.saveBook(book, arrayBuffer);
    return book;
  });
}

export function deletePersistedBookEffect(bookId: string) {
  return Effect.gen(function* () {
    const bookService = yield* BookService;
    const annotationService = yield* AnnotationService;
    const highlights = yield* annotationService.getHighlightsByBook(bookId);
    yield* Effect.forEach(highlights, (highlight) =>
      annotationService.deleteHighlight(highlight.id),
    );
    yield* bookService.deleteBook(bookId);
  });
}

export function downloadBookForOpenEffect(bookId: string) {
  return Effect.gen(function* () {
    const bookService = yield* BookService;
    yield* bookService.getBookData(bookId);
    const books = yield* bookService.getBooks();
    const book = books.find((candidate) => candidate.id === bookId);
    if (!book?.hasLocalFile) {
      return yield* Effect.fail(new Error(`Book ${bookId} did not become available locally`));
    }
    return book;
  });
}

async function persistUploadedBook(file: BookUploadFile) {
  return AppRuntime.runPromise(persistUploadedBookEffect(file));
}

async function deletePersistedBook(bookId: string) {
  return AppRuntime.runPromise(deletePersistedBookEffect(bookId));
}

async function downloadBookForOpen(bookId: string) {
  return AppRuntime.runPromise(downloadBookForOpenEffect(bookId));
}

function notifyBookAdded(callback: BookAddedCallback | undefined, book: BookMeta) {
  try {
    callback?.(book);
  } catch (error) {
    console.error("Failed to handle added book:", error);
  }
}

function notifyBookDeleted(callback: BookDeletedCallback | undefined, bookId: string) {
  try {
    callback?.(bookId);
  } catch (error) {
    console.error("Failed to handle deleted book:", error);
  }
}

function notifyUploadCompleted(callback: BookUploadCompletedCallback | undefined) {
  try {
    callback?.();
  } catch (error) {
    console.error("Failed to handle completed book upload:", error);
  }
}

function notifyUploadFailed(callback: BookUploadFailedCallback | undefined, error: string) {
  try {
    callback?.(error);
  } catch (callbackError) {
    console.error("Failed to handle book upload failure:", callbackError);
  }
}

async function notifyBookDownloadCompleted(
  callback: BookDownloadCompletedCallback,
  book: BookMeta,
) {
  try {
    await callback(book);
  } catch (error) {
    console.error("Failed to handle downloaded book:", error);
  }
}

function notifyBookDownloadFailed(callback: BookDownloadFailedCallback, error: string) {
  try {
    callback(error);
  } catch (callbackError) {
    console.error("Failed to handle book download failure:", callbackError);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function* hydrateBooksSaga() {
  try {
    const books = yield* call(loadBooks);
    yield* put(booksHydrated(books));
  } catch (error) {
    yield* put(booksHydrateFailed(errorMessage(error)));
  }
}

export function* uploadBooksSaga(action: ReturnType<typeof uploadBooksRequested>) {
  const [files, onBookAdded, onUploadCompleted, onUploadFailed] = action.payload;
  try {
    for (const file of files) {
      const book = yield* call(persistUploadedBook, file);
      yield* put(bookAdded(book));
      yield* call(notifyBookAdded, onBookAdded, book);
    }
    yield* put(booksUploadCompleted());
    yield* call(notifyUploadCompleted, onUploadCompleted);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(booksUploadFailed(message));
    yield* call(notifyUploadFailed, onUploadFailed, message);
  }
}

export function* deleteBookSaga(action: ReturnType<typeof deleteBookRequested>) {
  const [bookId, onBookDeleted] = action.payload;
  try {
    yield* call(deletePersistedBook, bookId);
    yield* put(bookDeleted(bookId));
    yield* put(bookDeletionCompleted(bookId));
    yield* call(notifyBookDeleted, onBookDeleted, bookId);
  } catch (error) {
    yield* put(bookDeletionFailed(bookId, errorMessage(error)));
  }
}

export function* downloadBookForOpenSaga(action: ReturnType<typeof downloadBookForOpenRequested>) {
  const [bookId, onCompleted, onFailed] = action.payload;
  try {
    const book = yield* call(downloadBookForOpen, bookId);
    yield* put(bookUpdated(book));
    yield* put(bookDownloadCompleted(bookId));
    yield* call(notifyBookDownloadCompleted, onCompleted, book);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(bookDownloadFailed(bookId, message));
    yield* call(notifyBookDownloadFailed, onFailed, message);
  }
}

export function* booksSaga() {
  yield* takeLatest(hydrateBooks, hydrateBooksSaga);
  yield* takeEvery(uploadBooksRequested, uploadBooksSaga);
  yield* takeEvery(deleteBookRequested, deleteBookSaga);
  yield* takeEvery(downloadBookForOpenRequested, downloadBookForOpenSaga);
}
