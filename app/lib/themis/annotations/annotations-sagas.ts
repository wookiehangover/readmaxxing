import { call, cancel, delay, fork, put, take, takeEvery } from "typed-redux-saga";

import { appendHighlightReferenceToNotebook } from "~/lib/annotations/append-highlight-to-notebook";
import { toTaggedError } from "~/lib/errors";
import { AnnotationService, type Highlight, type Notebook } from "~/lib/stores/annotations-store";
import {
  addHighlightRequested,
  annotationMutationFailed,
  annotationsHydrateFailed,
  annotationsHydrated,
  appendHighlightToNotebookRequested,
  cacheNotebookRequested,
  deleteHighlightRequested,
  highlightAdded,
  highlightDeleted,
  highlightUpdated,
  hydrateAnnotationsRequested,
  notebookSaved,
  updateHighlightRequested,
  updateNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";
import type {
  AnnotationFailedCallback,
  DeleteHighlightCompletedCallback,
  HighlightCompletedCallback,
  HighlightUpdate,
  NotebookCompletedCallback,
} from "~/lib/themis/annotations/annotations-types";

async function loadAnnotations(bookId: string) {
  const [highlights, notebook] = await Promise.all([
    AnnotationService.getHighlightsByBook(bookId),
    AnnotationService.getNotebook(bookId),
  ]);
  return { highlights, notebook };
}

async function persistHighlight(highlight: Highlight) {
  await AnnotationService.saveHighlight(highlight);
  const highlights = await AnnotationService.getHighlightsByBook(highlight.bookId);
  return highlights.find((candidate) => candidate.id === highlight.id) ?? highlight;
}

async function persistHighlightUpdate(
  bookId: string,
  highlightId: string,
  updates: HighlightUpdate,
) {
  await AnnotationService.updateHighlight(highlightId, updates);
  const highlights = await AnnotationService.getHighlightsByBook(bookId);
  const highlight = highlights.find((candidate) => candidate.id === highlightId);
  if (!highlight) throw new Error(`Highlight ${highlightId} was not found`);
  return highlight;
}

async function persistHighlightDeletion(highlightId: string) {
  return AnnotationService.deleteHighlight(highlightId);
}

async function persistNotebook(bookId: string, content: Notebook["content"]) {
  const notebook: Notebook = { bookId, content, updatedAt: Date.now() };
  return AnnotationService.saveNotebook(notebook);
}

async function persistCachedNotebook(notebook: Notebook) {
  return AnnotationService.cacheNotebook(notebook);
}

async function persistHighlightAppend(
  bookId: string,
  attrs: Parameters<typeof appendHighlightReferenceToNotebook>[1],
) {
  return appendHighlightReferenceToNotebook(bookId, attrs);
}

function notifyHighlightCompleted(
  callback: HighlightCompletedCallback | undefined,
  highlight: Highlight,
) {
  callback?.(highlight);
}

function notifyDeleteCompleted(callback: DeleteHighlightCompletedCallback | undefined) {
  callback?.();
}

function notifyNotebookCompleted(
  callback: NotebookCompletedCallback | undefined,
  notebook: Notebook,
) {
  callback?.(notebook);
}

function notifyFailed(callback: AnnotationFailedCallback | undefined, error: string) {
  callback?.(error);
}

export function* hydrateAnnotationsSaga(action: ReturnType<typeof hydrateAnnotationsRequested>) {
  const [bookId] = action.payload;
  try {
    const { highlights, notebook } = yield* call(loadAnnotations, bookId);
    yield* put(annotationsHydrated(bookId, highlights, notebook));
  } catch (error) {
    yield* put(annotationsHydrateFailed(bookId, toTaggedError(error)));
  }
}

export function* addHighlightSaga(action: ReturnType<typeof addHighlightRequested>) {
  const [highlight, onCompleted, onFailed] = action.payload;
  try {
    const saved = yield* call(persistHighlight, highlight);
    yield* put(highlightAdded(saved));
    yield* call(notifyHighlightCompleted, onCompleted, saved);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(highlight.bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

export function* updateHighlightSaga(action: ReturnType<typeof updateHighlightRequested>) {
  const [bookId, highlightId, updates, onCompleted, onFailed] = action.payload;
  try {
    const saved = yield* call(persistHighlightUpdate, bookId, highlightId, updates);
    yield* put(highlightUpdated(saved));
    yield* call(notifyHighlightCompleted, onCompleted, saved);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

export function* deleteHighlightSaga(action: ReturnType<typeof deleteHighlightRequested>) {
  const [bookId, highlightId, onCompleted, onFailed] = action.payload;
  try {
    yield* call(persistHighlightDeletion, highlightId);
    yield* put(highlightDeleted(highlightId));
    yield* call(notifyDeleteCompleted, onCompleted);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

export function* updateNotebookSaga(action: ReturnType<typeof updateNotebookRequested>) {
  const [bookId, content, immediate, onCompleted, onFailed] = action.payload;
  try {
    if (!immediate) yield* delay(1000);
    const notebook = yield* call(persistNotebook, bookId, content);
    yield* put(notebookSaved(notebook));
    yield* call(notifyNotebookCompleted, onCompleted, notebook);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

export function* cacheNotebookSaga(action: ReturnType<typeof cacheNotebookRequested>) {
  const [notebook, onCompleted, onFailed] = action.payload;
  try {
    const cached = yield* call(persistCachedNotebook, notebook);
    yield* put(notebookSaved(cached));
    yield* call(notifyNotebookCompleted, onCompleted, cached);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(notebook.bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

export function* appendHighlightToNotebookSaga(
  action: ReturnType<typeof appendHighlightToNotebookRequested>,
) {
  const [bookId, attrs, onCompleted, onFailed] = action.payload;
  try {
    const notebook = yield* call(persistHighlightAppend, bookId, attrs);
    yield* put(notebookSaved(notebook));
    yield* call(notifyNotebookCompleted, onCompleted, notebook);
  } catch (error) {
    const taggedError = toTaggedError(error);
    yield* put(annotationMutationFailed(bookId, taggedError));
    yield* call(notifyFailed, onFailed, taggedError.message);
  }
}

type NotebookSaveTask =
  ReturnType<
    typeof fork<Parameters<typeof updateNotebookSaga>, typeof updateNotebookSaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchNotebookUpdates() {
  const pendingByBookId = new Map<string, NotebookSaveTask>();
  while (true) {
    const action = yield* take(updateNotebookRequested);
    const [bookId] = action.payload;
    const pending = pendingByBookId.get(bookId);
    if (pending) yield* cancel(pending);
    pendingByBookId.set(bookId, yield* fork(updateNotebookSaga, action));
  }
}

type AnnotationHydrateTask =
  ReturnType<
    typeof fork<Parameters<typeof hydrateAnnotationsSaga>, typeof hydrateAnnotationsSaga>
  > extends Generator<unknown, infer Task, unknown>
    ? Task
    : never;

export function* watchAnnotationHydrates() {
  const pendingByBookId = new Map<string, AnnotationHydrateTask>();
  while (true) {
    const action = yield* take(hydrateAnnotationsRequested);
    const [bookId] = action.payload;
    const pending = pendingByBookId.get(bookId);
    if (pending) yield* cancel(pending);
    pendingByBookId.set(bookId, yield* fork(hydrateAnnotationsSaga, action));
  }
}

export function* annotationsSaga() {
  yield* fork(watchAnnotationHydrates);
  yield* takeEvery(addHighlightRequested, addHighlightSaga);
  yield* takeEvery(updateHighlightRequested, updateHighlightSaga);
  yield* takeEvery(deleteHighlightRequested, deleteHighlightSaga);
  yield* takeEvery(cacheNotebookRequested, cacheNotebookSaga);
  yield* takeEvery(appendHighlightToNotebookRequested, appendHighlightToNotebookSaga);
  yield* fork(watchNotebookUpdates);
}
