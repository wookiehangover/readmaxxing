import { equalDeliveredEnvelope } from "./delivery-fingerprint";
import { custodySession } from "./custody-session";
import {
  retainCustody,
  validateCustodyOwner,
  factsKey,
  type CustodyFacts,
} from "./custody-journal";
import { custodyUpdate, custodyDelete } from "./custody-write";
import { equalRaw, inLiveTransaction, liveTransactionBoundary } from "./raw-snapshot";
import { set, update, entries, promisifyRequest } from "idb-keyval";
import { ulid } from "ulid";
import { isWellFormedEntry } from "./idb-entry";
import { getChangeLogStore, getCustodyStore } from "./stores";
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
  persist?: () => Promise<unknown>,
): Promise<ChangeEntry> {
  const session = custodySession(entry.ownerId);
  const change: ChangeEntry = {
    ...structuredClone(entry),
    ...(session.ownerId ? { ownerId: session.ownerId } : {}),
    id: ulid(),
    synced: false,
  };
  const custodyId = await retainCustody({
    source: "changelog",
    key: change.id,
    raw: change,
    role: "transport",
    ownerId: change.ownerId,
  });
  session.checkActive();
  if (persist && (await persist()) === false) {
    await update<CustodyFacts>(
      factsKey(custodyId),
      (facts) => ({ ...facts, acknowledged: true }),
      getCustodyStore(),
    );
    return change;
  }
  session.checkActive();
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
  const pending = all
    .filter(isWellFormedEntry)
    .map(([, value]) => value)
    .filter(isUnsyncedChangeEntry)
    .filter((change) => !ownerId || !change.ownerId || change.ownerId === ownerId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!ownerId) return pending;
  const owned: ChangeEntry[] = [];
  for (const change of pending) {
    try {
      await validateCustodyOwner(ownerId, change);
      owned.push(change);
    } catch {
      /* Known foreign rows stay intact for their owner. */
    }
  }
  return owned;
}

/**
 * Mark a batch of changes as synced after successful push.
 */
export async function markSynced(ids: string[], snapshots?: ChangeEntry[]): Promise<void> {
  const sent = snapshots && new Map(snapshots.map((change) => [change.id, change]));
  await getChangeLogStore()("readwrite", (store) => {
    const done = promisifyRequest(store.transaction);
    const work = inLiveTransaction(store, async () => {
      for (const id of ids) {
        const entry = await promisifyRequest<ChangeEntry | undefined>(store.get(id));
        if (
          entry &&
          (!sent || (sent.has(id) && (await sameChangeSnapshot(entry, sent.get(id)!))))
        ) {
          await liveTransactionBoundary(store);
          store.put({ ...entry, synced: true }, id);
        }
      }
    });
    return Promise.all([done, work]).then(() => {});
  });
}

/**
 * Remove all synced changes from the store to reclaim space.
 * Call this periodically or after confirming server persistence.
 */
export async function clearSyncedChanges(
  ownerId?: string,
  receivedSnapshots: ChangeEntry[] = [],
): Promise<number> {
  let cleared = 0;
  for (const [id, entry] of (await entries<string, ChangeEntry>(getChangeLogStore())).filter(
    isWellFormedEntry,
  )) {
    if (entry?.synced !== true || (ownerId && entry.ownerId && ownerId !== entry.ownerId)) continue;
    const receipt = receivedSnapshots.find((snapshot) => snapshot.id === id);
    const covered =
      receipt && (await equalDeliveredEnvelope(receipt, JSON.parse(JSON.stringify(receipt))))
        ? { ...receipt, synced: true }
        : undefined;
    // Deletion itself revalidates the preimage after private retention.
    await custodyDelete(
      id,
      getChangeLogStore(),
      (current) =>
        !!current && typeof current === "object" && "synced" in current && current.synced === true,
      covered,
    );
    cleared++;
  }
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
    const done = promisifyRequest(store.transaction);
    const work = inLiveTransaction(store, async () => {
      for (const failure of failures) {
        const entry = await promisifyRequest<ChangeEntry | undefined>(store.get(failure.id));
        if (!entry || entry.synced) continue;
        if (
          sent &&
          (!sent.has(entry.id) || !(await sameChangeSnapshot(entry, sent.get(entry.id)!)))
        )
          continue;
        await liveTransactionBoundary(store);
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
      }
    });
    return Promise.all([done, work]).then(() => {});
  });
}

/** Rewrite even blocked entries in one transaction. A sent old revision cannot acknowledge this one. */
export async function remapQueuedChanges(ownerId: string, remaps: BookIdRemap[]): Promise<boolean> {
  let changed = false;
  for (const entry of await getUnsyncedChanges(ownerId)) {
    await custodyUpdate<ChangeEntry>(
      entry.id,
      (current) => {
        if (!current || current.synced || (current.ownerId && current.ownerId !== ownerId))
          return current;
        const rewritten = remaps.reduce(remapChange, current);
        if (rewritten === current) return current;
        changed = true;
        return { ...rewritten, ownerId, revision: (current.revision ?? 0) + 1 };
      },
      getChangeLogStore(),
      { ownerId },
    );
  }
  return changed;
}

/** Alias authority can first-bind late unowned legacy mutations, never a foreign one. */
export async function assignRemapOwners(
  remaps: Array<BookIdRemap & { ownerId: string }>,
): Promise<void> {
  if (!remaps.length) return;
  for (const entry of await getUnsyncedChanges()) {
    if (entry.ownerId) continue;
    const owners = new Set(
      remaps.filter((remap) => referencesRemappedBook(entry, remap)).map((remap) => remap.ownerId),
    );
    if (owners.size > 1) throw new Error("Ambiguous remap owner; outgoing changes retained");
    const ownerId = [...owners][0];
    if (!ownerId) continue;
    await custodyUpdate<ChangeEntry>(
      entry.id,
      (current) => (current && !current.ownerId ? { ...current, ownerId } : current),
      getChangeLogStore(),
      { ownerId },
    );
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

function replayContent(change: ChangeEntry): unknown {
  const fields = replayFields[change.entity];
  const data = change.data as Record<string, unknown> | null;
  return fields && data ? fields.map((field) => data[field]) : data;
}

/** Preserve raw input even when it cannot be replayed with a valid clock. */
export async function retainRemapReplay(
  ownerId: string,
  remap: BookIdRemap,
  input: Pick<ChangeEntry, "entity" | "entityId" | "operation" | "data" | "timestamp">,
): Promise<void> {
  await retainCustody({
    source: "remap-replay",
    key: input.entityId,
    raw: input,
    role: "before",
    ownerId,
  });
  if (!Number.isFinite(input.timestamp)) return;
  const candidate = remapChange({ ...input, id: ulid(), synced: false, ownerId }, remap);
  // Shared projection equality is an optimization only; private custody exists first.
  for (const entry of await getUnsyncedChanges(ownerId)) {
    const rewritten = remapChange(entry, remap);
    if (
      rewritten.entity === candidate.entity &&
      rewritten.entityId === candidate.entityId &&
      rewritten.operation === candidate.operation &&
      Object.is(rewritten.timestamp, candidate.timestamp) &&
      (await equalRaw(replayContent(rewritten), replayContent(candidate)))
    )
      return;
  }
  await retainCustody({
    source: "changelog",
    key: candidate.id,
    raw: candidate,
    role: "transport",
    ownerId,
  });
  await set(candidate.id, candidate, getChangeLogStore());
}
