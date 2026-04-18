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

/**
 * Options for {@link ReadingPositionService.savePosition}.
 *
 * `recordChange` controls whether the write is appended to the sync changelog.
 * Defaults to `true`. Set to `false` for local-only writes such as the
 * panel-specific mirror saved by `savePositionDualKey` — panel ids are
 * device-local UUIDs that no other device can ever consume, so syncing them
 * just doubles every page-turn push for zero benefit.
 */
export interface SavePositionOptions {
  readonly recordChange?: boolean;
}

export class ReadingPositionService extends Context.Tag("ReadingPositionService")<
  ReadingPositionService,
  {
    readonly savePosition: (
      bookId: string,
      cfi: string,
      options?: SavePositionOptions,
    ) => Effect.Effect<void, PositionError>;
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
    savePosition: (bookId: string, cfi: string, options?: SavePositionOptions) =>
      Effect.tryPromise({
        try: async () => {
          // Short-circuit no-op writes: if the stored CFI matches exactly,
          // skip both the IDB write and the sync changelog entry. Without
          // this, a stuck `relocated` event source (e.g. a visibility /
          // dimensions cycle) can enqueue one identical position change per
          // debounce interval and drive /api/sync/push in a loop.
          const existing = migratePosition(await get<unknown>(bookId, positionStore));
          if (existing && existing.cfi === cfi) return;

          const record: PositionRecord = { cfi, updatedAt: Date.now() };
          await set(bookId, record, positionStore);
          if (options?.recordChange !== false) {
            recordChange({
              entity: "position",
              entityId: bookId,
              operation: "put",
              data: record,
              timestamp: record.updatedAt,
            }).catch(console.error);
          }
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
