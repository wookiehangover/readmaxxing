import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { Context, Effect, Layer } from "effect";
import { StorageError } from "~/lib/errors";

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _locationsStore: ReturnType<typeof createStore> | null = null;

function getLocationsStore() {
  if (!_locationsStore) _locationsStore = createStore("ebook-reader-locations", "locations");
  return _locationsStore;
}

// --- Effect Service ---

export class LocationCacheService extends Context.Tag("LocationCacheService")<
  LocationCacheService,
  {
    readonly saveLocations: (bookId: string, json: string) => Effect.Effect<void, StorageError>;
    readonly getLocations: (bookId: string) => Effect.Effect<string | null, StorageError>;
  }
>() {}

export interface LocationCacheServiceStores {
  readonly locationsStore: UseStore;
}

export function makeLocationCacheService(
  stores: LocationCacheServiceStores,
): LocationCacheService["Type"] {
  const { locationsStore } = stores;
  return {
    saveLocations: (bookId: string, json: string) =>
      Effect.tryPromise({
        try: () => set(bookId, json, locationsStore),
        catch: (cause) => new StorageError({ operation: "saveLocations", cause }),
      }),

    getLocations: (bookId: string) =>
      Effect.tryPromise({
        try: async () => {
          const json = await get<string>(bookId, locationsStore);
          return json ?? null;
        },
        catch: (cause) => new StorageError({ operation: "getLocations", cause }),
      }),
  };
}

export const LocationCacheServiceLive = Layer.sync(LocationCacheService, () =>
  makeLocationCacheService({ locationsStore: getLocationsStore() }),
);
