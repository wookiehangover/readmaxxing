import { createStore, get, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import { getUnsyncedChanges, markSynced, clearSyncedChanges } from "./change-log";
import { getCursor, setCursor } from "./sync-cursors";
import { lwwMerge } from "./merge";
import type {
  EntityType,
  SyncPushRequest,
  SyncPushResponse,
  SyncPullResponse,
  SyncCursor,
} from "./types";

// ---------------------------------------------------------------------------
// IDB store accessors (same db/store names as book-store & position-store,
// accessed directly to avoid circular Effect service dependencies)
// ---------------------------------------------------------------------------

let _bookStore: ReturnType<typeof createStore> | null = null;
let _positionStore: ReturnType<typeof createStore> | null = null;

function getBookStore(): UseStore {
  if (!_bookStore) _bookStore = createStore("ebook-reader-db", "books");
  return _bookStore;
}

function getPositionStore(): UseStore {
  if (!_positionStore) _positionStore = createStore("ebook-reader-positions", "positions");
  return _positionStore;
}

// ---------------------------------------------------------------------------
// SyncEngine interface
// ---------------------------------------------------------------------------

export interface SyncEngine {
  /** Push all unsynced local changes to the server. */
  pushChanges(): Promise<void>;
  /** Pull remote changes for all entity types and merge into local IDB. */
  pullChanges(): Promise<void>;
  /** Start periodic push/pull intervals and do an immediate pull. */
  startSync(): void;
  /** Stop all periodic sync intervals. */
  stopSync(): void;
  /** Trigger an immediate push (e.g. after a local write). */
  triggerPush(): void;
}

// ---------------------------------------------------------------------------
// Entity types we actively sync (subset of all EntityType values)
// ---------------------------------------------------------------------------

const SYNCABLE_ENTITIES: EntityType[] = ["book", "position"];

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

async function mergeBookRecord(record: Record<string, unknown>): Promise<void> {
  const store = getBookStore();
  const id = record.id as string;
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, record, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, record as { updatedAt: number });
  if (merged === record) {
    await set(id, record, store);
  }
}

async function mergePositionRecord(record: Record<string, unknown>): Promise<void> {
  const store = getPositionStore();
  const bookId = record.bookId as string | undefined;
  const id = bookId ?? (record.id as string);
  const local = await get<Record<string, unknown>>(id, store);

  if (!local) {
    await set(id, record, store);
    return;
  }

  const merged = lwwMerge(local as { updatedAt: number }, record as { updatedAt: number });
  if (merged === record) {
    await set(id, record, store);
  }
}

const ENTITY_MERGERS: Partial<
  Record<EntityType, (record: Record<string, unknown>) => Promise<void>>
> = {
  book: mergeBookRecord,
  position: mergePositionRecord,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SyncEngineCallbacks {
  onSyncStart?: () => void;
  onSyncEnd?: () => void;
  onSyncError?: (error: Error) => void;
  onAuthExpired?: () => void;
}

const PUSH_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 60_000;

export function makeSyncEngine(callbacks: SyncEngineCallbacks = {}): SyncEngine {
  let pushTimer: ReturnType<typeof setInterval> | null = null;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function pushChanges(): Promise<void> {
    if (stopped) return;
    const changes = await getUnsyncedChanges();
    if (changes.length === 0) return;

    const body: SyncPushRequest = { changes };
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      callbacks.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Push failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPushResponse = await res.json();
    if (result.accepted.length > 0) {
      await markSynced(result.accepted);
      await clearSyncedChanges();
    }
  }

  async function pullChanges(): Promise<void> {
    if (stopped) return;

    const cursors: SyncCursor[] = [];
    for (const entity of SYNCABLE_ENTITIES) {
      const cursor = await getCursor(entity);
      if (cursor) {
        cursors.push({ entityType: entity, cursor });
      }
    }

    const params = new URLSearchParams();
    if (cursors.length > 0) {
      params.set("cursors", JSON.stringify(cursors));
    }

    const res = await fetch(`/api/sync/pull?${params.toString()}`);

    if (res.status === 401) {
      callbacks.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Pull failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPullResponse = await res.json();

    for (const group of result.changes) {
      const merger = ENTITY_MERGERS[group.entity];
      if (!merger) continue;

      for (const record of group.records) {
        await merger(record as Record<string, unknown>);
      }

      await setCursor(group.entity, group.cursor);
    }
  }

  async function runCycle(fn: () => Promise<void>): Promise<void> {
    try {
      callbacks.onSyncStart?.();
      await fn();
    } catch (err) {
      callbacks.onSyncError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      callbacks.onSyncEnd?.();
    }
  }

  return {
    pushChanges: () => runCycle(pushChanges),
    pullChanges: () => runCycle(pullChanges),

    startSync() {
      stopped = false;
      // Immediate pull on start
      runCycle(pullChanges);
      pushTimer = setInterval(() => runCycle(pushChanges), PUSH_INTERVAL_MS);
      pullTimer = setInterval(() => runCycle(pullChanges), PULL_INTERVAL_MS);
    },

    stopSync() {
      stopped = true;
      if (pushTimer) {
        clearInterval(pushTimer);
        pushTimer = null;
      }
      if (pullTimer) {
        clearInterval(pullTimer);
        pullTimer = null;
      }
    },

    triggerPush() {
      runCycle(pushChanges);
    },
  };
}
