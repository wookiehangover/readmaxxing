import { createStore, get, set, del, keys } from "idb-keyval";
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

// --- Live implementation ---

const highlightStore = createStore("ebook-reader-highlights", "highlights");
const notebookStore = createStore("ebook-reader-notebooks", "notebooks");

export const AnnotationServiceLive = Layer.succeed(AnnotationService, {
  saveHighlight: (highlight) =>
    Effect.tryPromise({
      try: () => set(highlight.id, highlight, highlightStore),
      catch: (cause) =>
        new HighlightError({ operation: "saveHighlight", highlightId: highlight.id, cause }),
    }),

  getHighlightsByBook: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const allKeys = await keys(highlightStore);
        const highlights: Highlight[] = [];
        for (const key of allKeys) {
          const hl = await get<Highlight>(key, highlightStore);
          if (hl && hl.bookId === bookId) {
            highlights.push(hl);
          }
        }
        return highlights;
      },
      catch: (cause) => new HighlightError({ operation: "getHighlightsByBook", cause }),
    }),

  updateHighlight: (id, updates) =>
    Effect.tryPromise({
      try: async () => {
        const existing = await get<Highlight>(id, highlightStore);
        if (!existing) return;
        await set(id, { ...existing, ...updates }, highlightStore);
      },
      catch: (cause) =>
        new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
    }),

  deleteHighlight: (id) =>
    Effect.tryPromise({
      try: () => del(id, highlightStore),
      catch: (cause) =>
        new HighlightError({ operation: "deleteHighlight", highlightId: id, cause }),
    }),

  saveNotebook: (notebook) =>
    Effect.tryPromise({
      try: () => set(notebook.bookId, notebook, notebookStore),
      catch: (cause) =>
        new NotebookError({ operation: "saveNotebook", bookId: notebook.bookId, cause }),
    }),

  getNotebook: (bookId) =>
    Effect.tryPromise({
      try: async () => {
        const notebook = await get<Notebook>(bookId, notebookStore);
        return notebook ?? null;
      },
      catch: (cause) => new NotebookError({ operation: "getNotebook", bookId, cause }),
    }),
});
