import {
  addItems,
  createCollection,
  filterCollection,
  removeItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { JSONContent } from "@tiptap/react";

import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";
import type { Highlight, Notebook } from "~/lib/stores/annotations-store";
import type {
  AnnotationFailedCallback,
  AnnotationsState,
  DeleteHighlightCompletedCallback,
  HighlightCompletedCallback,
  HighlightUpdate,
  NotebookCompletedCallback,
} from "~/lib/themis/annotations/annotations-types";

export const hydrateAnnotationsRequested = createAction<[bookId: string]>(
  "annotations/hydrateRequested",
);
export const annotationsHydrated =
  createAction<[bookId: string, highlights: Highlight[], notebook: Notebook | null]>(
    "annotations/hydrated",
  );
export const annotationsHydrateFailed = createAction<[bookId: string, error: string]>(
  "annotations/hydrateFailed",
);
export const addHighlightRequested = createAction<
  [
    highlight: Highlight,
    onCompleted?: HighlightCompletedCallback,
    onFailed?: AnnotationFailedCallback,
  ]
>("annotations/addHighlightRequested");
export const highlightAdded = createAction<[highlight: Highlight]>("annotations/highlightAdded");
export const updateHighlightRequested = createAction<
  [
    bookId: string,
    highlightId: string,
    updates: HighlightUpdate,
    onCompleted?: HighlightCompletedCallback,
    onFailed?: AnnotationFailedCallback,
  ]
>("annotations/updateHighlightRequested");
export const highlightUpdated = createAction<[highlight: Highlight]>(
  "annotations/highlightUpdated",
);
export const deleteHighlightRequested = createAction<
  [
    bookId: string,
    highlightId: string,
    onCompleted?: DeleteHighlightCompletedCallback,
    onFailed?: AnnotationFailedCallback,
  ]
>("annotations/deleteHighlightRequested");
export const highlightDeleted = createAction<[highlightId: string]>("annotations/highlightDeleted");
export const updateNotebookRequested = createAction<
  [
    bookId: string,
    content: JSONContent,
    immediate?: boolean,
    onCompleted?: NotebookCompletedCallback,
    onFailed?: AnnotationFailedCallback,
  ]
>("annotations/updateNotebookRequested");
export const appendHighlightToNotebookRequested = createAction<
  [
    bookId: string,
    attrs: HighlightReferenceAttrs,
    onCompleted?: NotebookCompletedCallback,
    onFailed?: AnnotationFailedCallback,
  ]
>("annotations/appendHighlightToNotebookRequested");
export const notebookSaved = createAction<[notebook: Notebook]>("annotations/notebookSaved");
export const annotationMutationFailed = createAction<[bookId: string, error: string]>(
  "annotations/mutationFailed",
);

export const annotationsInitialState: AnnotationsState = {
  highlights: createCollection<Highlight, "id">("id"),
  notebooks: createCollection<Notebook, "bookId">("bookId"),
  loadingBookIds: [],
  loadedBookIds: [],
  errorsByBookId: {},
};

const reducer = createReducer<AnnotationsState>(annotationsInitialState);

reducer.with(hydrateAnnotationsRequested, (state, { payload: [bookId] }) => {
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    loadingBookIds: state.loadingBookIds.includes(bookId)
      ? state.loadingBookIds
      : [...state.loadingBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(annotationsHydrated, (state, { payload: [bookId, highlights, notebook] }) => {
  const otherHighlights = filterCollection(
    state.highlights,
    (highlight): highlight is Highlight => highlight.bookId !== bookId,
  );
  const { [bookId]: _, ...errorsByBookId } = state.errorsByBookId;
  return {
    ...state,
    highlights: addItems(otherHighlights, highlights),
    notebooks: notebook
      ? upsertItem(state.notebooks, notebook)
      : removeItem(state.notebooks, bookId),
    loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
    loadedBookIds: state.loadedBookIds.includes(bookId)
      ? state.loadedBookIds
      : [...state.loadedBookIds, bookId],
    errorsByBookId,
  };
});
reducer.with(annotationsHydrateFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  loadingBookIds: state.loadingBookIds.filter((id) => id !== bookId),
  loadedBookIds: state.loadedBookIds.includes(bookId)
    ? state.loadedBookIds
    : [...state.loadedBookIds, bookId],
  errorsByBookId: { ...state.errorsByBookId, [bookId]: error },
}));
reducer.with(highlightAdded, (state, { payload: [highlight] }) => ({
  ...state,
  highlights: upsertItem(state.highlights, highlight),
}));
reducer.with(highlightUpdated, (state, { payload: [highlight] }) => ({
  ...state,
  highlights: upsertItem(state.highlights, highlight),
}));
reducer.with(highlightDeleted, (state, { payload: [highlightId] }) => ({
  ...state,
  highlights: removeItem(state.highlights, highlightId),
}));
reducer.with(notebookSaved, (state, { payload: [notebook] }) => ({
  ...state,
  notebooks: upsertItem(state.notebooks, notebook),
}));
reducer.with(annotationMutationFailed, (state, { payload: [bookId, error] }) => ({
  ...state,
  errorsByBookId: { ...state.errorsByBookId, [bookId]: error },
}));

export const annotationsReducer = reducer;
