import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { StorageError } from "~/lib/errors";

// --- idb-keyval store (lazy-initialized for SSR safety) ---

let _locationsStore: ReturnType<typeof createStore> | null = null;

function getLocationsStore() {
  if (!_locationsStore) _locationsStore = createStore("ebook-reader-locations", "locations");
  return _locationsStore;
}

export interface LocationCacheServiceStores {
  readonly locationsStore: UseStore;
}

export function makeLocationCacheService(stores: LocationCacheServiceStores) {
  const { locationsStore } = stores;
  return {
    async saveLocations(bookId: string, json: string) {
      try {
        await set(bookId, json, locationsStore);
      } catch (cause) {
        throw new StorageError({ operation: "saveLocations", cause });
      }
    },

    async getLocations(bookId: string) {
      try {
        return (await get<string>(bookId, locationsStore)) ?? null;
      } catch (cause) {
        throw new StorageError({ operation: "getLocations", cause });
      }
    },
  };
}

export const LocationCacheService = makeLocationCacheService({
  locationsStore: getLocationsStore(),
});
