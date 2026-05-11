import { createStore, get, set, del, entries } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { ulid } from "ulid";
import { isWellFormedEntry } from "./idb-entry";
import type { ChangeEntry } from "./types";

// ---------------------------------------------------------------------------
// idb-keyval store (lazy-initialized for SSR safety)
// ---------------------------------------------------------------------------

let _changeLogStore: ReturnType<typeof createStore> | null = null;

function getChangeLogStore(): UseStore {
  if (!_changeLogStore) _changeLogStore = createStore("ebook-reader-changelog", "changes");
  return _changeLogStore;
}

function isUnsyncedChangeEntry(entry: unknown): entry is ChangeEntry {
  return (
    !!entry &&
    typeof entry === "object" &&
    "id" in entry &&
    "synced" in entry &&
    typeof entry.id === "string" &&
    entry.synced === false
  );
}

function isSyncedChangeEntry(entry: unknown): entry is ChangeEntry {
  return !!entry && typeof entry === "object" && "synced" in entry && entry.synced === true;
}

function isNonNullIDBValidKey(key: unknown): key is IDBValidKey {
  return key !== null && key !== undefined;
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
  // Position changes are not urgent enough to trigger an immediate push.
  // They batch with the regular 30s push interval. Triggering immediate
  // pushes causes SyncStatus re-renders → Dockview dimension changes →
  // resize+display cycles that fight the reader's current position.
  if (typeof window !== "undefined" && entry.entity !== "position") {
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
    .filter(isWellFormedEntry)
    .map(([, value]) => value)
    .filter(isUnsyncedChangeEntry)
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
  const synced = all.filter(
    (entry): entry is [string, ChangeEntry] =>
      isWellFormedEntry(entry) && isNonNullIDBValidKey(entry[0]) && isSyncedChangeEntry(entry[1]),
  );
  await Promise.all(synced.map(([key]) => del(key, store)));
  return synced.length;
}
