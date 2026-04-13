import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { PositionError } from "~/lib/errors";

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _positionStore: ReturnType<typeof createStore> | null = null;

function getPositionStore() {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

// --- Effect Service ---

export class ReadingPositionService extends Context.Tag("ReadingPositionService")<
  ReadingPositionService,
  {
    readonly savePosition: (bookId: string, cfi: string) => Effect.Effect<void, PositionError>;
    readonly getPosition: (bookId: string) => Effect.Effect<string | null, PositionError>;
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
        try: () => set(bookId, cfi, positionStore),
        catch: (cause) => new PositionError({ operation: "savePosition", bookId, cause }),
      }),

    getPosition: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const cfi = await get<string>(bookId, positionStore);
          return cfi ?? null;
        },
        catch: (cause) => new PositionError({ operation: "getPosition", bookId, cause }),
      }),
  };
}

export const ReadingPositionServiceLive = Layer.sync(ReadingPositionService, () =>
  makePositionService({ positionStore: getPositionStore() }),
);
