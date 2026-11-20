import { entries, get, set, update } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type { JSONContent } from "@tiptap/react";
import { HighlightError, NotebookError, DecodeError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";
import { isWellFormedEntry } from "~/lib/sync/idb-entry";
import { getHighlightStore, getNotebookStore } from "~/lib/sync/stores";

export interface HighlightTextAnchor {
  chapterIndex: number;
  snippet: string;
  offset?: number;
}

export interface Highlight {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  color: string;
  createdAt: number;
  pageNumber?: number;
  textOffset?: number;
  textLength?: number;
  textAnchor?: HighlightTextAnchor;
  note?: string;
  updatedAt?: number;
  deletedAt?: number;
}

const decodeHighlight = (raw: unknown): Highlight => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid highlight");
  const value = raw as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.bookId !== "string" ||
    typeof value.cfiRange !== "string" ||
    typeof value.text !== "string" ||
    typeof value.color !== "string" ||
    typeof value.createdAt !== "number"
  ) {
    throw new Error("Invalid highlight");
  }
  return value as unknown as Highlight;
};

export interface Notebook {
  bookId: string;
  content: JSONContent;
  updatedAt: number;
}

const decodeNotebook = (raw: unknown): Notebook => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid notebook");
  const value = raw as Record<string, unknown>;
  if (
    typeof value.bookId !== "string" ||
    !value.content ||
    typeof value.content !== "object" ||
    Array.isArray(value.content) ||
    typeof value.updatedAt !== "number"
  ) {
    throw new Error("Invalid notebook");
  }
  return value as unknown as Notebook;
};

export interface AnnotationServiceStores {
  readonly highlightStore: UseStore;
  readonly notebookStore: UseStore;
}

export function makeAnnotationService(stores: AnnotationServiceStores) {
  const { highlightStore, notebookStore } = stores;
  return {
    async saveHighlight(highlight: Highlight) {
      try {
        const stamped = { ...highlight, updatedAt: highlight.updatedAt ?? Date.now() };
        await set(highlight.id, stamped, highlightStore);
        recordChange({
          entity: "highlight",
          entityId: highlight.id,
          operation: "put",
          data: stamped,
          timestamp: stamped.updatedAt!,
        }).catch(console.error);
      } catch (cause) {
        throw new HighlightError({ operation: "saveHighlight", highlightId: highlight.id, cause });
      }
    },

    async getHighlightsByBook(bookId: string) {
      let allEntries: [IDBValidKey, unknown][];
      try {
        allEntries = await entries(highlightStore);
      } catch (cause) {
        throw new HighlightError({ operation: "getHighlightsByBook", cause });
      }
      try {
        const highlights: Highlight[] = [];
        for (const entry of allEntries) {
          if (!isWellFormedEntry(entry)) continue;
          const [key, raw] = entry;
          if (raw == null || typeof raw !== "object") continue;
          try {
            const highlight = decodeHighlight(raw);
            if (highlight.bookId === bookId && highlight.deletedAt === undefined) {
              highlights.push(highlight);
            }
          } catch (err) {
            console.warn(
              `[annotations-store] Skipping malformed highlight record (key=${String(key)})`,
              err,
            );
          }
        }
        return highlights;
      } catch (cause) {
        throw new DecodeError({ operation: "getHighlightsByBook", cause });
      }
    },

    async updateHighlight(
      id: string,
      updates: Partial<Omit<Highlight, "id" | "bookId" | "createdAt">>,
    ) {
      let raw: unknown;
      try {
        raw = await get(id, highlightStore);
      } catch (cause) {
        throw new HighlightError({ operation: "updateHighlight", highlightId: id, cause });
      }
      if (!raw) {
        throw new HighlightError({ operation: "updateHighlight", highlightId: id });
      }
      let existing: Highlight;
      try {
        existing = decodeHighlight(raw);
      } catch (cause) {
        throw new DecodeError({ operation: "updateHighlight", cause });
      }
      const now = Date.now();
      const updated = { ...existing, ...updates, updatedAt: now };
      try {
        await set(id, updated, highlightStore);
      } catch (cause) {
        throw new HighlightError({ operation: "updateHighlight", highlightId: id, cause });
      }
      recordChange({
        entity: "highlight",
        entityId: id,
        operation: "put",
        data: updated,
        timestamp: now,
      }).catch(console.error);
    },

    async deleteHighlight(id: string) {
      let raw: unknown;
      try {
        raw = await get(id, highlightStore);
      } catch (cause) {
        throw new HighlightError({ operation: "deleteHighlight.read", highlightId: id, cause });
      }
      if (raw) {
        let existing: Highlight;
        try {
          existing = decodeHighlight(raw);
        } catch (cause) {
          throw new DecodeError({ operation: "deleteHighlight.decode", cause });
        }
        const now = Date.now();
        const tombstone = { ...existing, deletedAt: now, updatedAt: now };
        try {
          await set(id, tombstone, highlightStore);
        } catch (cause) {
          throw new HighlightError({
            operation: "deleteHighlight.write",
            highlightId: id,
            cause,
          });
        }
        recordChange({
          entity: "highlight",
          entityId: id,
          operation: "delete",
          data: tombstone,
          timestamp: now,
        }).catch(console.error);
      }
    },

    async saveNotebook(notebook: Notebook) {
      try {
        let persisted = notebook;
        await update<unknown>(
          notebook.bookId,
          (raw) => {
            if (raw !== undefined) {
              const existing = decodeNotebook(raw);
              if (existing.updatedAt > notebook.updatedAt) {
                persisted = existing;
                return existing;
              }
            }
            return notebook;
          },
          notebookStore,
        );
        if (persisted !== notebook) return persisted;
        recordChange({
          entity: "notebook",
          entityId: notebook.bookId,
          operation: "put",
          data: notebook,
          timestamp: notebook.updatedAt,
        }).catch(console.error);
        return notebook;
      } catch (cause) {
        throw new NotebookError({ operation: "saveNotebook", bookId: notebook.bookId, cause });
      }
    },

    async cacheNotebook(notebook: Notebook) {
      try {
        let persisted = notebook;
        await update<unknown>(
          notebook.bookId,
          (raw) => {
            if (raw !== undefined) {
              const existing = decodeNotebook(raw);
              if (existing.updatedAt > notebook.updatedAt) {
                persisted = existing;
                return existing;
              }
            }
            return notebook;
          },
          notebookStore,
        );
        return persisted;
      } catch (cause) {
        throw new NotebookError({ operation: "cacheNotebook", bookId: notebook.bookId, cause });
      }
    },

    async getNotebook(bookId: string) {
      let raw: unknown;
      try {
        raw = await get(bookId, notebookStore);
      } catch (cause) {
        throw new NotebookError({ operation: "getNotebook", bookId, cause });
      }
      if (!raw) return null;
      try {
        return decodeNotebook(raw);
      } catch (cause) {
        throw new DecodeError({ operation: "getNotebook", cause });
      }
    },
  };
}

export const AnnotationService = makeAnnotationService({
  highlightStore: getHighlightStore(),
  notebookStore: getNotebookStore(),
});
