import { del, entries, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { ulid } from "ulid";
import { ReadingHistoryError } from "~/lib/errors";
import { getReadingHistoryStore } from "~/lib/sync/stores";

export interface ReadingHistoryEntry {
  readonly id: string;
  readonly bookId: string;
  readonly cfi: string;
  readonly chapterHref: string | null;
  readonly chapterLabel: string | null;
  readonly percentage: number;
  readonly pageIndex: number | null;
  readonly totalPages: number | null;
  readonly timestamp: number;
}

export type ReadingHistoryVisitData = Omit<ReadingHistoryEntry, "id" | "bookId" | "timestamp">;

export interface GetReadingHistoryOptions {
  readonly limit?: number;
}

export interface ReadingHistoryServiceStores {
  readonly historyStore: UseStore;
}

const lastCfiByBook = new Map<string, string>();

function makeHistoryKey(bookId: string, id: string): string {
  return `${bookId}:${id}`;
}

function makeBookKeyPrefix(bookId: string): string {
  return `${bookId}:`;
}

function isReadingHistoryEntry(value: unknown): value is ReadingHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ReadingHistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.bookId === "string" &&
    typeof entry.cfi === "string" &&
    (entry.chapterHref === null || typeof entry.chapterHref === "string") &&
    (entry.chapterLabel === null || typeof entry.chapterLabel === "string") &&
    typeof entry.percentage === "number" &&
    (entry.pageIndex === null || typeof entry.pageIndex === "number") &&
    (entry.totalPages === undefined ||
      entry.totalPages === null ||
      typeof entry.totalPages === "number") &&
    typeof entry.timestamp === "number"
  );
}

async function getEntriesForBook(
  bookId: string,
  historyStore: UseStore,
): Promise<ReadingHistoryEntry[]> {
  const prefix = makeBookKeyPrefix(bookId);
  const allEntries = await entries<string, unknown>(historyStore);
  const history: ReadingHistoryEntry[] = [];
  for (const [key, value] of allEntries) {
    if (!key.startsWith(prefix) || !isReadingHistoryEntry(value) || value.bookId !== bookId) {
      continue;
    }
    history.push(value);
  }
  return history.sort((a, b) => b.id.localeCompare(a.id));
}

export function makeReadingHistoryService(stores: ReadingHistoryServiceStores) {
  const { historyStore } = stores;
  return {
    async recordVisit(bookId: string, data: ReadingHistoryVisitData) {
      try {
        const cachedCfi = lastCfiByBook.get(bookId);
        if (cachedCfi === data.cfi) return;

        if (cachedCfi === undefined) {
          const previousEntry = (await getEntriesForBook(bookId, historyStore))[0];
          if (previousEntry) {
            lastCfiByBook.set(bookId, previousEntry.cfi);
            if (previousEntry.cfi === data.cfi) return;
          }
        }

        const id = ulid();
        const entry: ReadingHistoryEntry = {
          ...data,
          id,
          bookId,
          timestamp: Date.now(),
        };

        await set(makeHistoryKey(bookId, id), entry, historyStore);
        lastCfiByBook.set(bookId, data.cfi);

        if (typeof window !== "undefined") {
          queueMicrotask(() => {
            window.dispatchEvent(
              new CustomEvent("reading-history:updated", { detail: { bookId, entry } }),
            );
          });
        }
      } catch (cause) {
        throw new ReadingHistoryError({ operation: "recordVisit", bookId, cause });
      }
    },

    async getHistory(bookId: string, opts?: GetReadingHistoryOptions) {
      try {
        const history = await getEntriesForBook(bookId, historyStore);
        if (opts?.limit === undefined) return history;
        return history.slice(0, Math.max(0, opts.limit));
      } catch (cause) {
        throw new ReadingHistoryError({ operation: "getHistory", bookId, cause });
      }
    },

    async clearHistory(bookId: string) {
      try {
        const prefix = makeBookKeyPrefix(bookId);
        const allEntries = await entries<string, unknown>(historyStore);
        const keys = allEntries.filter(([key]) => key.startsWith(prefix)).map(([key]) => key);
        await Promise.all(keys.map((key) => del(key, historyStore)));
        lastCfiByBook.delete(bookId);

        if (typeof window !== "undefined") {
          queueMicrotask(() => {
            window.dispatchEvent(
              new CustomEvent("reading-history:updated", { detail: { bookId } }),
            );
          });
        }
      } catch (cause) {
        throw new ReadingHistoryError({ operation: "clearHistory", bookId, cause });
      }
    },
  };
}

export const ReadingHistoryService = makeReadingHistoryService({
  historyStore: getReadingHistoryStore(),
});
