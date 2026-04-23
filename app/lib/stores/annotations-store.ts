import { get, set, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer, Schema } from "effect";
import type { JSONContent } from "@tiptap/react";
import { HighlightError, NotebookError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { getHighlightStore, getNotebookStore } from "~/lib/sync/stores";

// --- Schemas ---

/**
 * Text-anchor for AI-created highlights. Produced server-side when the AI
 * calls `create_highlight`, before a CFI is known. The client resolves this
 * to a CFI inside the epub iframe and updates the highlight via LWW sync.
 */
export const HighlightTextAnchorSchema = Schema.Struct({
  chapterIndex: Schema.Number,
  snippet: Schema.String,
  offset: Schema.optional(Schema.Number),
});

export const HighlightSchema = Schema.Struct({
  id: Schema.String,
  bookId: Schema.String,
  cfiRange: Schema.String,
  text: Schema.String,
  color: Schema.String,
  createdAt: Schema.Number,
  /** PDF-only: page number where the highlight lives */
  pageNumber: Schema.optional(Schema.Number),
  /** PDF-only: character offset within the page text content */
  textOffset: Schema.optional(Schema.Number),
  /** PDF-only: length of highlighted text in characters */
  textLength: Schema.optional(Schema.Number),
  /** Server-created AI highlights carry a text-anchor until the client resolves a CFI. */
  textAnchor: Schema.optional(HighlightTextAnchorSchema),
  /** Optional explanatory note (set by AI via create_highlight). */
  note: Schema.optional(Schema.String),
  /** Timestamp of last mutation. Used for LWW sync. */
  updatedAt: Schema.optional(Schema.Number),
  /** Soft-delete timestamp. When set, the highlight is considered deleted. */
  deletedAt: Schema.optional(Schema.Number),
});

export type Highlight = typeof HighlightSchema.Type;

const decodeHighlight = Schema.decodeUnknownSync(HighlightSchema);

/**
 * Notebook content is a TipTap JSONContent tree — opaque structure
 * that we validate structurally (must be a record) but don't deeply schema-check.
 */
export const NotebookSchema = Schema.Struct({
  bookId: Schema.String,
  content: Schema.Unknown,
  updatedAt: Schema.Number,
});

/** Notebook with TipTap JSONContent. The content field is validated as present but not deeply checked. */
export interface Notebook {
  bookId: string;
  content: JSONContent;
  updatedAt: number;
}

const decodeNotebook = (raw: unknown): Notebook => {
  const decoded = Schema.decodeUnknownSync(NotebookSchema)(raw);
  return decoded as unknown as Notebook;
};

// --- Service interface ---

export class AnnotationService extends Context.Tag("AnnotationService")<
  AnnotationService,
  {
    readonly saveHighlight: (highlight: Highlight) => Effect.Effect<void, HighlightError>;
    readonly getHighlightsByBook: (
      bookId: string,
    ) => Effect.Effect<Highlight[], HighlightError | DecodeError>;
    readonly updateHighlight: (
      id: string,
      updates: Partial<Omit<Highlight, "id" | "bookId" | "createdAt">>,
    ) => Effect.Effect<void, HighlightError | DecodeError>;
    readonly deleteHighlight: (id: string) => Effect.Effect<void, HighlightError | DecodeError>;
    readonly saveNotebook: (notebook: Notebook) => Effect.Effect<void, NotebookError>;
    /**
     * Writes a notebook row to IndexedDB without recording a sync change.
     * Used when applying server-authoritative notebook state (e.g. edit_notes
     * tool output) where the server has already persisted the canonical value
     * and re-recording a local change would echo it back on the next push.
     */
    readonly cacheNotebook: (notebook: Notebook) => Effect.Effect<void, NotebookError>;
    readonly getNotebook: (
      bookId: string,
    ) => Effect.Effect<Notebook | null, NotebookError | DecodeError>;
  }
>() {}

// --- idb-keyval stores imported from ~/lib/sync/stores ---

// --- Factory + Live implementation ---

export interface AnnotationServiceStores {
  readonly highlightStore: UseStore;
  readonly notebookStore: UseStore;
}

export function makeAnnotationService(stores: AnnotationServiceStores): AnnotationService["Type"] {
  const { highlightStore, notebookStore } = stores;
  return {
    saveHighlight: (highlight) =>
      Effect.tryPromise({
        try: async () => {
          const stamped = { ...highlight, updatedAt: highlight.updatedAt ?? Date.now() };
          await set(highlight.id, stamped, highlightStore);
          recordChange({
            entity: "highlight",
            entityId: highlight.id,
            operation: "put",
            data: stamped,
            timestamp: stamped.updatedAt!,
          }).catch(console.error);
        },
        catch: (cause) =>
          new HighlightError({ operation: "saveHighlight", highlightId: highlight.id, cause }),
      }),

    getHighlightsByBook: (bookId) =>
      Effect.gen(function* () {
        const allEntries = yield* Effect.tryPromise({
          try: () => entries<string, unknown>(highlightStore),
          catch: (cause) => new HighlightError({ operation: "getHighlightsByBook", cause }),
        });
        return yield* Effect.try({
          try: () =>
            allEntries
              .map(([, raw]) => raw)
              .filter(Boolean)
              .map((raw) => decodeHighlight(raw))
              .filter((hl) => hl.bookId === bookId && hl.deletedAt === undefined),
          catch: (cause) => new DecodeError({ operation: "getHighlightsByBook", cause }),
        });
      }),

    updateHighlight: (id, updates) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(id, highlightStore),
          catch: (cause) =>
            new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
        });
        if (!raw) {
          return yield* Effect.fail(
            new HighlightError({ operation: "updateHighlight", highlightId: id }),
          );
        }
        const existing = yield* Effect.try({
          try: () => decodeHighlight(raw),
          catch: (cause) => new DecodeError({ operation: "updateHighlight", cause }),
        });
        const now = Date.now();
        const updated = { ...existing, ...updates, updatedAt: now };
        yield* Effect.tryPromise({
          try: () => set(id, updated, highlightStore),
          catch: (cause) =>
            new HighlightError({ operation: "updateHighlight", highlightId: id, cause }),
        });
        recordChange({
          entity: "highlight",
          entityId: id,
          operation: "put",
          data: updated,
          timestamp: now,
        }).catch(console.error);
      }),

    deleteHighlight: (id) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(id, highlightStore),
          catch: (cause) =>
            new HighlightError({ operation: "deleteHighlight.read", highlightId: id, cause }),
        });
        if (raw) {
          // Soft-delete: set deletedAt timestamp, keep record for sync
          const existing = yield* Effect.try({
            try: () => decodeHighlight(raw),
            catch: (cause) => new DecodeError({ operation: "deleteHighlight.decode", cause }),
          });
          const now = Date.now();
          const tombstone = { ...existing, deletedAt: now, updatedAt: now };
          yield* Effect.tryPromise({
            try: () => set(id, tombstone, highlightStore),
            catch: (cause) =>
              new HighlightError({
                operation: "deleteHighlight.write",
                highlightId: id,
                cause,
              }),
          });
          recordChange({
            entity: "highlight",
            entityId: id,
            operation: "delete",
            data: tombstone,
            timestamp: now,
          }).catch(console.error);
        }
      }),

    saveNotebook: (notebook) =>
      Effect.tryPromise({
        try: async () => {
          await set(notebook.bookId, notebook, notebookStore);
          recordChange({
            entity: "notebook",
            entityId: notebook.bookId,
            operation: "put",
            data: notebook,
            timestamp: notebook.updatedAt,
          }).catch(console.error);
        },
        catch: (cause) =>
          new NotebookError({ operation: "saveNotebook", bookId: notebook.bookId, cause }),
      }),

    cacheNotebook: (notebook) =>
      Effect.tryPromise({
        try: () => set(notebook.bookId, notebook, notebookStore),
        catch: (cause) =>
          new NotebookError({ operation: "cacheNotebook", bookId: notebook.bookId, cause }),
      }),

    getNotebook: (bookId) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => get<unknown>(bookId, notebookStore),
          catch: (cause) => new NotebookError({ operation: "getNotebook", bookId, cause }),
        });
        if (!raw) return null;
        return yield* Effect.try({
          try: () => decodeNotebook(raw),
          catch: (cause) => new DecodeError({ operation: "getNotebook", cause }),
        });
      }),
  };
}

export const AnnotationServiceLive = Layer.sync(AnnotationService, () =>
  makeAnnotationService({ highlightStore: getHighlightStore(), notebookStore: getNotebookStore() }),
);
