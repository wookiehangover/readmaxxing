import { call, put, takeEvery, takeLatest, takeLeading } from "typed-redux-saga";

import { computeFileHash } from "~/lib/book-hash";
import { parseEpub } from "~/lib/epub/epub-service";
import {
  completeDemoOnboarding,
  fetchDemoEpub,
  isFirstVisit,
  provisionDemoContent,
} from "~/lib/onboarding/demo-seed";
import { persistAdoptedDemoContent } from "~/lib/onboarding/adopt-demo";
import { DEMO_BOOK_ID, DEMO_BOOK_METADATA, DEMO_EPUB_PATH } from "~/lib/onboarding/demo-content";
import { parsePdf } from "~/lib/pdf/pdf-service";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService, type BookFormat, type BookMeta } from "~/lib/stores/book-store";
import { evictCachedCover } from "~/lib/sw-cache";
import {
  adoptDemoBookRequested,
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
  demoBookSeeded,
  deleteBookRequested,
  downloadBookForOpenRequested,
  hydrateBooks,
  importSharedBookRequested,
  loadBookDataRequested,
  replaceBookFileRequested,
  seedDemoBookRequested,
  updateBookMetadataRequested,
  uploadBooksRequested,
  type BookAddedCallback,
  type BookDeletedCallback,
  type BookDataLoadedCallback,
  type BookMutationCompletedCallback,
  type BookMutationFailedCallback,
  type BookReplacementRequest,
  type BookUploadCompletedCallback,
  type BookUploadFailedCallback,
  type BookUploadFile,
  type DemoAdoptionCompletedCallback,
  type SharedBookImportRequest,
} from "~/lib/themis/books/books-slice";

interface PersistUploadedBookOptions {
  id?: string;
  metadata?: Partial<BookMeta>;
  preferProvidedMetadata?: boolean;
  existingPatch?: Partial<BookMeta>;
}

interface ShareResolveResponse {
  book: { title: string | null; author: string | null; format: string | null };
  fileUrl: string;
  sharerId: string;
}

async function loadBooks() {
  return BookService.getBooks();
}

export async function persistUploadedBook(
  file: BookUploadFile,
  options: PersistUploadedBookOptions = {},
) {
  const arrayBuffer = await file.arrayBuffer();
  const fileHash = await computeFileHash(arrayBuffer);
  const existing = await BookService.findByFileHash(fileHash);
  if (existing) {
    if (!options.existingPatch) return existing;
    const updated = { ...existing, ...options.existingPatch };
    return BookService.updateBookMeta(updated);
  }

  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const format: BookFormat = isPdf ? "pdf" : "epub";
  const metadata = isPdf ? await parsePdf(arrayBuffer, file.name) : await parseEpub(arrayBuffer);
  const provided = options.metadata;
  const book: BookMeta = {
    ...provided,
    id: options.id ?? crypto.randomUUID(),
    title: options.preferProvidedMetadata
      ? (provided?.title ?? metadata.title)
      : metadata.title || provided?.title || "Untitled",
    author: options.preferProvidedMetadata
      ? (provided?.author ?? metadata.author)
      : metadata.author || provided?.author || "Unknown Author",
    coverImage: metadata.coverImage,
    format: provided?.format ?? format,
    fileHash,
  };

  return BookService.saveBook(book, arrayBuffer);
}

function readApiError(response: Response) {
  return response
    .json()
    .catch(() => null)
    .then((body: unknown) => {
      const error = body && typeof body === "object" && "error" in body ? body.error : null;
      return typeof error === "string"
        ? error
        : `Request failed with ${response.status} ${response.statusText}`;
    });
}

async function importSharedBook(request: SharedBookImportRequest) {
  const shareInfo = await (async () => {
    const response = await fetch(`/api/share/${encodeURIComponent(request.shareId)}`);
    if (!response.ok) throw new Error(await readApiError(response));
    return (await response.json()) as ShareResolveResponse;
  })().catch((cause) => {
    throw cause instanceof Error ? cause : new Error("Failed to resolve share");
  });
  const data = await (async () => {
    const response = await fetch(shareInfo.fileUrl);
    if (!response.ok) throw new Error(await readApiError(response));
    return response.arrayBuffer();
  })().catch((cause) => {
    throw cause instanceof Error ? cause : new Error("Failed to download shared book");
  });
  const format: BookFormat =
    shareInfo.book.format === "pdf"
      ? "pdf"
      : shareInfo.book.format === "epub"
        ? "epub"
        : request.format;
  const extension = format === "pdf" ? "pdf" : "epub";
  return persistUploadedBook(
    { name: `${request.title}.${extension}`, arrayBuffer: async () => data },
    {
      metadata: {
        title: shareInfo.book.title ?? request.title,
        author: shareInfo.book.author ?? request.author,
        format,
        sharedBy: shareInfo.sharerId,
        shareId: request.shareId,
      },
      existingPatch: { sharedBy: shareInfo.sharerId, shareId: request.shareId },
    },
  );
}

export async function replacePersistedBook(request: BookReplacementRequest) {
  const data = await request.file.arrayBuffer();
  const fileHash = await computeFileHash(data);
  const metadata = await parseEpub(data);
  await BookService.replaceBookFile(request.bookId, data, {
    coverImage: metadata.coverImage,
    fileHash,
  });
  let book = await BookService.getBookIncludingDeleted(request.bookId);
  await evictCachedCover(request.bookId, request.remoteCoverUrl);

  if (request.syncActive) {
    await request
      .reloadBookFiles(request.bookId)
      .catch((error) => console.error("Failed to reload replacement book files:", error));
    book = await BookService.getBookIncludingDeleted(request.bookId).catch((error) => {
      console.error("Failed to read synced replacement book:", error);
      return book;
    });
    await evictCachedCover(request.bookId, book.remoteCoverUrl);
  }
  return book;
}

async function persistDemoBook() {
  const data = await fetchDemoEpub();
  const book = await persistUploadedBook(
    { name: DEMO_EPUB_PATH, arrayBuffer: async () => data },
    {
      id: DEMO_BOOK_ID,
      metadata: DEMO_BOOK_METADATA,
      preferProvidedMetadata: true,
    },
  );
  await provisionDemoContent(book);
  completeDemoOnboarding();
  return book;
}

export async function deletePersistedBook(bookId: string) {
  const highlights = await AnnotationService.getHighlightsByBook(bookId);
  await Promise.all(highlights.map((highlight) => AnnotationService.deleteHighlight(highlight.id)));
  await BookService.deleteBook(bookId);
}

export async function downloadBookForOpen(bookId: string) {
  await BookService.getBookData(bookId);
  const books = await BookService.getBooks();
  const book = books.find((candidate) => candidate.id === bookId);
  if (!book?.hasLocalFile) {
    throw new Error(`Book ${bookId} did not become available locally`);
  }
  return book;
}

async function adoptDemoBook(userId: string) {
  const result = await persistAdoptedDemoContent(userId);
  const book = await BookService.getBookIncludingDeleted(result.bookId);
  return { result, book };
}

async function loadBookData(bookId: string) {
  return BookService.getBookData(bookId);
}

async function persistBookMetadata(book: BookMeta) {
  return BookService.updateBookMeta(book);
}

function notifyBookAdded(callback: BookAddedCallback | undefined, book: BookMeta) {
  try {
    callback?.(book);
  } catch (error) {
    console.error("Failed to handle added book:", error);
  }
}

function notifyBookDataLoaded(callback: BookDataLoadedCallback, data: ArrayBuffer) {
  callback(data);
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

async function notifyBookMutationCompleted(
  callback: BookMutationCompletedCallback,
  book: BookMeta,
) {
  try {
    await callback(book);
  } catch (error) {
    console.error("Failed to handle downloaded book:", error);
  }
}

function notifyBookMutationFailed(callback: BookMutationFailedCallback, error: string) {
  try {
    callback(error);
  } catch (callbackError) {
    console.error("Failed to handle book download failure:", callbackError);
  }
}

async function notifyDemoAdoptionCompleted(
  callback: DemoAdoptionCompletedCallback,
  result: { bookId: string; sessionId: string },
) {
  try {
    await callback(result);
  } catch (error) {
    console.error("Failed to handle adopted demo:", error);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function* hydrateBooksSaga() {
  try {
    const books = yield* call(loadBooks);
    yield* put(booksHydrated(books));
    yield* put(seedDemoBookRequested());
  } catch (error) {
    yield* put(booksHydrateFailed(errorMessage(error)));
  }
}

export function* importSharedBookSaga(action: ReturnType<typeof importSharedBookRequested>) {
  const [request, onCompleted, onFailed] = action.payload;
  try {
    const book = yield* call(importSharedBook, request);
    yield* put(bookAdded(book));
    yield* call(notifyBookMutationCompleted, onCompleted, book);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(booksUploadFailed(message));
    yield* call(notifyBookMutationFailed, onFailed, message);
  }
}

export function* replaceBookFileSaga(action: ReturnType<typeof replaceBookFileRequested>) {
  const [request, onCompleted, onFailed] = action.payload;
  try {
    const book = yield* call(replacePersistedBook, request);
    yield* put(bookUpdated(book));
    yield* call(notifyBookMutationCompleted, onCompleted, book);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(booksUploadFailed(message));
    yield* call(notifyBookMutationFailed, onFailed, message);
  }
}

export function* seedDemoBookSaga() {
  try {
    if (!(yield* call(isFirstVisit))) return;
    const book = yield* call(persistDemoBook);
    yield* put(bookAdded(book));
    yield* put(demoBookSeeded(book.id));
  } catch (error) {
    yield* put(booksUploadFailed(errorMessage(error)));
  }
}

export function* adoptDemoBookSaga(action: ReturnType<typeof adoptDemoBookRequested>) {
  const [userId, onCompleted, onFailed] = action.payload;
  try {
    const { result, book } = yield* call(adoptDemoBook, userId);
    yield* put(bookAdded(book));
    yield* put(bookDeleted(DEMO_BOOK_ID));
    yield* call(notifyDemoAdoptionCompleted, onCompleted, result);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(booksUploadFailed(message));
    yield* call(notifyBookMutationFailed, onFailed, message);
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
    yield* call(notifyBookMutationCompleted, onCompleted, book);
  } catch (error) {
    const message = errorMessage(error);
    yield* put(bookDownloadFailed(bookId, message));
    yield* call(notifyBookMutationFailed, onFailed, message);
  }
}

export function* loadBookDataSaga(action: ReturnType<typeof loadBookDataRequested>) {
  const [bookId, onCompleted, onFailed] = action.payload;
  try {
    const data = yield* call(loadBookData, bookId);
    yield* call(notifyBookDataLoaded, onCompleted, data);
  } catch (error) {
    yield* call(notifyBookMutationFailed, onFailed, errorMessage(error));
  }
}

export function* updateBookMetadataSaga(action: ReturnType<typeof updateBookMetadataRequested>) {
  const [book, mutation, onCompleted, onFailed] = action.payload;
  try {
    const persistedBook = yield* call(persistBookMetadata, book);
    yield* put(mutation === "restore" ? bookAdded(persistedBook) : bookUpdated(persistedBook));
    yield* call(notifyBookMutationCompleted, onCompleted, persistedBook);
  } catch (error) {
    yield* call(notifyBookMutationFailed, onFailed, errorMessage(error));
  }
}

export function* booksSaga() {
  yield* takeLatest(hydrateBooks, hydrateBooksSaga);
  yield* takeEvery(uploadBooksRequested, uploadBooksSaga);
  yield* takeEvery(importSharedBookRequested, importSharedBookSaga);
  yield* takeEvery(replaceBookFileRequested, replaceBookFileSaga);
  yield* takeLeading(seedDemoBookRequested, seedDemoBookSaga);
  yield* takeEvery(adoptDemoBookRequested, adoptDemoBookSaga);
  yield* takeEvery(deleteBookRequested, deleteBookSaga);
  yield* takeEvery(downloadBookForOpenRequested, downloadBookForOpenSaga);
  yield* takeEvery(loadBookDataRequested, loadBookDataSaga);
  yield* takeEvery(updateBookMetadataRequested, updateBookMetadataSaga);
}
