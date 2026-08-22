import { createStore, get, set, keys } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { WorkspaceError } from "~/lib/errors";

// --- idb-keyval stores (lazy-initialized for SSR safety) ---

let _lastOpenedStore: ReturnType<typeof createStore> | null = null;

function getLastOpenedStore() {
  if (!_lastOpenedStore) _lastOpenedStore = createStore("workspace-last-opened-db", "last-opened");
  return _lastOpenedStore;
}

export interface WorkspaceServiceStores {
  readonly lastOpenedStore: UseStore;
}

export function makeWorkspaceService(stores: WorkspaceServiceStores) {
  const { lastOpenedStore } = stores;

  return {
    async saveLastOpened(bookId: string, timestamp: number) {
      try {
        await set(bookId, timestamp, lastOpenedStore);
      } catch (cause) {
        throw new WorkspaceError({ operation: "saveLastOpened", cause });
      }
    },

    async getLastOpenedMap() {
      try {
        const allKeys = await keys(lastOpenedStore);
        const map = new Map<string, number>();
        for (const key of allKeys) {
          if (typeof key !== "string") continue;
          const timestamp = await get<unknown>(key, lastOpenedStore);
          if (typeof timestamp !== "number") continue;
          map.set(key, timestamp);
        }
        return map;
      } catch (cause) {
        throw new WorkspaceError({ operation: "getLastOpenedMap", cause });
      }
    },
  };
}

export const WorkspaceService = makeWorkspaceService({
  lastOpenedStore: getLastOpenedStore(),
});
