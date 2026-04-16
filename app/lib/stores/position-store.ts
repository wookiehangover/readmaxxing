import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { PositionError } from "~/lib/errors";
import { recordChange } from "~/lib/sync/change-log";

// --- Types ---

/** New position record with LWW timestamp. */
export interface PositionRecord {
  cfi: string;
  updatedAt: number;
}

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _positionStore: ReturnType<typeof createStore> | null = null;

function getPositionStore() {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

/**
 * Migrate a raw IDB value to PositionRecord.
 * Old format: plain string CFI. New format: { cfi, updatedAt }.
 */
function migratePosition(raw: unknown): PositionRecord | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    // Legacy plain-string format — treat as { cfi, updatedAt: 0 }
    return { cfi: raw, updatedAt: 0 };
  }
  if (typeof raw === "object" && "cfi" in raw) {
    const rec = raw as PositionRecord;
    return { cfi: rec.cfi, updatedAt: rec.updatedAt ?? 0 };
  }
  return null;
}

// --- Effect Service ---

export class ReadingPositionService extends Context.Tag("ReadingPositionService")<
  ReadingPositionService,
  {
    readonly savePosition: (bookId: string, cfi: string) => Effect.Effect<void, PositionError>;
    readonly getPosition: (bookId: string) => Effect.Effect<string | null, PositionError>;
    readonly getPositionRecord: (
      bookId: string,
    ) => Effect.Effect<PositionRecord | null, PositionError>;
  }
>() {}

export interface PositionServiceStores {
  readonly positionStore: UseStore;
}

export function makePositionService(stores: PositionServiceStores): ReadingPositionService["Type"] {
  const { positionStore } = stores;
  return {
    savePosition: (bookId: string, cfi: string) =>
      Effect.tryPromise({
        try: async () => {
          const record: PositionRecord = { cfi, updatedAt: Date.now() };
          await set(bookId, record, positionStore);
          recordChange({
            entity: "position",
            entityId: bookId,
            operation: "put",
            data: record,
            timestamp: record.updatedAt,
          }).catch(console.error);
        },
        catch: (cause) => new PositionError({ operation: "savePosition", bookId, cause }),
      }),

    getPosition: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const raw = await get<unknown>(bookId, positionStore);
          const record = migratePosition(raw);
          return record?.cfi ?? null;
        },
        catch: (cause) => new PositionError({ operation: "getPosition", bookId, cause }),
      }),

    getPositionRecord: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const raw = await get<unknown>(bookId, positionStore);
          return migratePosition(raw);
        },
        catch: (cause) => new PositionError({ operation: "getPositionRecord", bookId, cause }),
      }),
  };
}

export const ReadingPositionServiceLive = Layer.sync(ReadingPositionService, () =>
  makePositionService({ positionStore: getPositionStore() }),
);
