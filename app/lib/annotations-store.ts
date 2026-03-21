import { createStore, get, set, del, entries } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import type { JSONContent } from "@tiptap/react";
import { HighlightError, NotebookError } from "~/lib/errors";

// --- Types ---

export interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
  createdAt: number;
}

export interface Notebook {
  bookId: string;
  content: JSONContent;
  updatedAt: number;
}

// --- Service interface ---

export class AnnotationService extends Context.Tag("AnnotationService")<
  AnnotationService,
  {
    readonly saveHighlight: (highlight: Highlight) => Effect.Effect<void, HighlightError>;
    readonly getHighlightsByBook: (bookId: string) => Effect.Effect<Highlight[], HighlightError>;
    readonly updateHighlight: (
      id: string,
      updates: Partial<Omit<Highlight, "id" | "bookId" | "createdAt">>,
    ) => Effect.Effect<void, HighlightError>;
    readonly deleteHighlight: (id: string) => Effect.Effect<void, HighlightError>;
    readonly saveNotebook: (notebook: Notebook) => Effect.Effect<void, NotebookError>;
    readonly getNotebook: (bookId: string) => Effect.Effect<Notebook | null, NotebookError>;
  }
>() {}

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

let _highlightStore: ReturnType<typeof createStore> | null = null;
let _notebookStore: ReturnType<typeof createStore> | null = null;

function getHighlightStore() {
  if (!_highlightStore) _highlightStore = createStore("ebook-reader-highlights", "highlights");
  return _highlightStore;
}

function getNotebookStore() {
  if (!_notebookStore) _notebookStore = createStore("ebook-reader-notebooks", "notebooks");
  return _notebookStore;
}

// --- Live implementation ---

export const AnnotationServiceLive = Layer.succeed(AnnotationService, {
  saveHighlight: (highlight) =>
    Effect.tryPromise({
      try: () => set(highlight.id, highlight, getHighlightStore()),
      catch: (cause) =>
        new HighlightError({ operation: "saveHighlight", highlightId: highlight.id, cause }),
    }),

  getHighlightsByBook: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const allEntries = await entries<string, Highlight>(getHighlightStore());
        return allEntries.map(([, hl]) => hl).filter((hl) => hl && hl.bookId === bookId);
      },
      catch: (cause) => new HighlightError({ operation: "getHighlightsByBook", cause }),
    }),

  updateHighlight: (id, updates) =>
    Effect.gen(function* () {
      const existing = yield* Effect.tryPromise({
        try: () => get<Highlight>(id, getHighlightStore()),
        catch: (cause) =>
          new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
      });
      if (!existing) {
        return yield* Effect.fail(
          new HighlightError({ operation: "updateHighlight", highlightId: id }),
        );
      }
      yield* Effect.tryPromise({
        try: () => set(id, { ...existing, ...updates }, getHighlightStore()),
        catch: (cause) =>
          new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
      });
    }),

  deleteHighlight: (id) =>
    Effect.tryPromise({
      try: () => del(id, getHighlightStore()),
      catch: (cause) =>
        new HighlightError({ operation: "deleteHighlight", highlightId: id, cause }),
    }),

  saveNotebook: (notebook) =>
    Effect.tryPromise({
      try: () => set(notebook.bookId, notebook, getNotebookStore()),
      catch: (cause) =>
        new NotebookError({ operation: "saveNotebook", bookId: notebook.bookId, cause }),
    }),

  getNotebook: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const notebook = await get<Notebook>(bookId, getNotebookStore());
        return notebook ?? null;
      },
      catch: (cause) => new NotebookError({ operation: "getNotebook", bookId, cause }),
    }),
});
