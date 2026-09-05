import { set, entries, promisifyRequest } from "idb-keyval";
import { ulid } from "ulid";
import { isWellFormedEntry } from "./idb-entry";
import { getChangeLogStore } from "./stores";
import {
  remapChange,
  sameChangeSnapshot,
  referencesRemappedBook,
  type BookIdRemap,
} from "./remap-references";
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
export async function getUnsyncedChanges(ownerId?: string): Promise<ChangeEntry[]> {
  const all = await entries<string, ChangeEntry>(getChangeLogStore());
  return all
    .filter(isWellFormedEntry)
    .map(([, value]) => value)
    .filter(isUnsyncedChangeEntry)
    .filter((change) => !ownerId || !change.ownerId || change.ownerId === ownerId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Mark a batch of changes as synced after successful push.
 */
export async function markSynced(ids: string[], snapshots?: ChangeEntry[]): Promise<void> {
  const sent = snapshots && new Map(snapshots.map((change) => [change.id, change]));
  await getChangeLogStore()("readwrite", (store) => {
    for (const id of ids) {
      const request = store.get(id);
      request.onsuccess = () => {
        const entry = request.result as ChangeEntry | undefined;
        if (entry && (!sent || (sent.has(id) && sameChangeSnapshot(entry, sent.get(id)!)))) {
          store.put({ ...entry, synced: true }, id);
        }
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
  let cleared = 0;
  await getChangeLogStore()("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value?.synced === true) {
        cursor.delete();
        cleared++;
      }
      cursor.continue();
    };
    return promisifyRequest(store.transaction);
  });
  return cleared;
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
  snapshots?: ChangeEntry[],
): Promise<void> {
  const sent = snapshots && new Map(snapshots.map((change) => [change.id, change]));
  await getChangeLogStore()("readwrite", (store) => {
    for (const failure of failures) {
      const request = store.get(failure.id);
      request.onsuccess = () => {
        const entry = request.result as ChangeEntry | undefined;
        if (!entry || entry.synced) return;
        if (sent && (!sent.has(entry.id) || !sameChangeSnapshot(entry, sent.get(entry.id)!)))
          return;
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

/** Rewrite even blocked entries in one transaction. A sent old revision cannot acknowledge this one. */
export async function remapQueuedChanges(ownerId: string, remaps: BookIdRemap[]): Promise<boolean> {
  let changed = false;
  await getChangeLogStore()("readwrite", (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as ChangeEntry;
      if (isUnsyncedChangeEntry(entry) && (!entry.ownerId || entry.ownerId === ownerId)) {
        const rewritten = remaps.reduce(remapChange, entry);
        if (rewritten !== entry) {
          cursor.update({ ...rewritten, ownerId, revision: (entry.revision ?? 0) + 1 });
          changed = true;
        }
      }
      cursor.continue();
    };
    return promisifyRequest(store.transaction);
  });
  return changed;
}

/** A late unowned producer still belongs to the account owning its explicit alias. */
export async function assignRemapOwners(
  remaps: Array<BookIdRemap & { ownerId: string }>,
): Promise<void> {
  if (!remaps.length) return;
  let ambiguous = false;
  try {
    await getChangeLogStore()("readwrite", (store) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const entry = cursor.value as ChangeEntry;
        if (isUnsyncedChangeEntry(entry) && !entry.ownerId) {
          const owners = new Set(
            remaps
              .filter((remap) => referencesRemappedBook(entry, remap))
              .map((remap) => remap.ownerId),
          );
          if (owners.size > 1) {
            ambiguous = true;
            store.transaction.abort();
            return;
          }
          if (owners.size === 1) cursor.update({ ...entry, ownerId: [...owners][0] });
        }
        cursor.continue();
      };
      return promisifyRequest(store.transaction);
    });
  } catch (error) {
    if (ambiguous) throw new Error("Ambiguous remap owner; outgoing changes retained");
    throw error;
  }
}

const replayFields: Partial<Record<ChangeEntry["entity"], string[]>> = {
  notebook: ["bookId", "content"],
  position: ["cfi"],
  highlight: [
    "id",
    "bookId",
    "cfiRange",
    "text",
    "color",
    "pageNumber",
    "textOffset",
    "textLength",
    "textAnchor",
    "note",
    "createdAt",
    "deletedAt",
  ],
  bookmark: ["id", "bookId", "cfi", "label", "pageNumber", "displayPage", "createdAt", "deletedAt"],
  chat_session: ["id", "bookId", "title", "createdAt", "deletedAt"],
};

function replayContent(change: ChangeEntry): string | undefined {
  const fields = replayFields[change.entity];
  const data = change.data as Record<string, unknown> | null;
  return JSON.stringify(fields && data ? fields.map((field) => data[field]) : data);
}

/** Preserve a surviving local snapshot before its old storage key is removed. */
export async function retainRemapReplay(
  ownerId: string,
  remap: BookIdRemap,
  input: Pick<ChangeEntry, "entity" | "entityId" | "operation" | "data" | "timestamp">,
): Promise<void> {
  // A legacy record with no source clock must not acquire a fresh winning clock.
  if (!Number.isFinite(input.timestamp)) return;
  const candidate = remapChange({ ...input, id: ulid(), synced: false, ownerId }, remap);
  await getChangeLogStore()("readwrite", (store) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const exists = (request.result as ChangeEntry[]).some((entry) => {
        if (!isUnsyncedChangeEntry(entry) || (entry.ownerId && entry.ownerId !== ownerId))
          return false;
        const rewritten = remapChange(entry, remap);
        // Preserve the delivery state of equivalent payloads. A distinct local
        // payload at the same clock must survive as an ambiguous conflict too.
        return (
          rewritten.entity === candidate.entity &&
          rewritten.entityId === candidate.entityId &&
          rewritten.timestamp === candidate.timestamp &&
          rewritten.operation === candidate.operation &&
          replayContent(rewritten) === replayContent(candidate)
        );
      });
      if (!exists) store.put(candidate, candidate.id);
    };
    return promisifyRequest(store.transaction);
  });
}
