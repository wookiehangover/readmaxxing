import { set, del, entries, promisifyRequest } from "idb-keyval";
import { ulid } from "ulid";
import { isWellFormedEntry } from "./idb-entry";
import { getChangeLogStore } from "./stores";
import type { ChangeEntry, SyncPushResponse } from "./types";

let positionPushTimer: ReturnType<typeof setTimeout> | null = null;

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
  entry: Omit<ChangeEntry, "id" | "synced" | "failure">,
): Promise<ChangeEntry> {
  const change: ChangeEntry = {
    ...entry,
    id: ulid(),
    synced: false,
  };
  await set(change.id, change, getChangeLogStore());
  // Signal the sync engine to push rather than waiting for the next interval.
  // Non-position events are deferred to a microtask to avoid triggering React
  // state updates during render.
  // Position changes should sync soon for cross-device use, but not instantly.
  // Debouncing avoids push-triggered re-renders during active reader navigation.
  if (typeof window !== "undefined") {
    if (entry.entity === "position") {
      if (positionPushTimer) clearTimeout(positionPushTimer);
      positionPushTimer = setTimeout(() => {
        positionPushTimer = null;
        window.dispatchEvent(new CustomEvent("sync:push-needed"));
      }, 5000);
    } else {
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent("sync:push-needed"));
      });
    }
  }
  return change;
}

/**
 * Retrieve all unsynced changes, including retained failures, ordered by ULID.
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
  await getChangeLogStore()("readwrite", (store) => {
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const entry = request.result as ChangeEntry | undefined;
        if (entry) store.put({ ...entry, synced: true }, id);
      };
    }
    return promisifyRequest(store.transaction);
  });
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

/** Whether a retained mutation may participate in the next automatic push. */
export function isChangeReadyToPush(change: ChangeEntry, now = Date.now()): boolean {
  return (
    !change.failure || (change.failure.retryable && (change.failure.nextAttemptAt ?? 0) <= now)
  );
}

/** Persist failures atomically without recreating acknowledged/deleted entries. */
export async function recordPushFailures(
  failures: SyncPushResponse["rejected"],
  now = Date.now(),
): Promise<void> {
  await getChangeLogStore()("readwrite", (store) => {
    for (const failure of failures) {
      const request = store.get(failure.id);
      request.onsuccess = () => {
        const entry = request.result as ChangeEntry | undefined;
        if (!entry || entry.synced) return;
        const attempts = (entry.failure?.attempts ?? 0) + 1;
        const retryable = failure.retryable !== false;
        // Start at the normal push interval; cap delay at 30 minutes, never attempts.
        const delay = Math.min(30_000 * 2 ** Math.min(attempts - 1, 6), 1_800_000);
        store.put(
          {
            ...entry,
            failure: {
              reason: failure.reason,
              retryable,
              attempts,
              lastAttemptAt: now,
              ...(retryable ? { nextAttemptAt: now + delay } : {}),
            },
          },
          failure.id,
        );
      };
    }
    return promisifyRequest(store.transaction);
  });
}
