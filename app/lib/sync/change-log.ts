import { createStore, get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { ulid } from "ulid";
import type { ChangeEntry } from "./types";

// ---------------------------------------------------------------------------
// idb-keyval store (lazy-initialized for SSR safety)
// ---------------------------------------------------------------------------

let _changeLogStore: ReturnType<typeof createStore> | null = null;

function getChangeLogStore(): UseStore {
  if (!_changeLogStore) _changeLogStore = createStore("ebook-reader-changelog", "changes");
  return _changeLogStore;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a new change in the local change log.
 * Automatically generates a ULID and marks the entry as unsynced.
 */
export async function recordChange(
  entry: Omit<ChangeEntry, "id" | "synced">,
): Promise<ChangeEntry> {
  const change: ChangeEntry = {
    ...entry,
    id: ulid(),
    synced: false,
  };
  await set(change.id, change, getChangeLogStore());
  // Signal the sync engine to push immediately rather than waiting for the
  // next interval (reduces cross-device latency from ~30s+ to near-instant).
  // Deferred to a microtask to avoid triggering React state updates during render.
  if (typeof window !== "undefined") {
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent("sync:push-needed"));
    });
  }
  return change;
}

/**
 * Retrieve all unsynced changes, ordered by ULID (chronological).
 */
export async function getUnsyncedChanges(): Promise<ChangeEntry[]> {
  const all = await entries<string, ChangeEntry>(getChangeLogStore());
  return all
    .map(([_, value]) => value)
    .filter((entry) => !entry.synced)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Mark a batch of changes as synced after successful push.
 */
export async function markSynced(ids: string[]): Promise<void> {
  const store = getChangeLogStore();
  await Promise.all(
    ids.map(async (id) => {
      const entry = await get<ChangeEntry>(id, store);
      if (entry) {
        await set(id, { ...entry, synced: true }, store);
      }
    }),
  );
}

/**
 * Remove all synced changes from the store to reclaim space.
 * Call this periodically or after confirming server persistence.
 */
export async function clearSyncedChanges(): Promise<number> {
  const store = getChangeLogStore();
  const all = await entries<string, ChangeEntry>(store);
  const synced = all.filter(([_, value]) => value.synced);
  await Promise.all(synced.map(([key]) => del(key, store)));
  return synced.length;
}
