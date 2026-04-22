import { upload } from "@vercel/blob/client";
import { get, set, entries } from "idb-keyval";
import { getUnsyncedChanges, markSynced, clearSyncedChanges, recordChange } from "./change-log";
import { ENTITY_MERGERS, mergeBookRecord, mergeChatSessionRecord } from "./entity-mergers";
import { remapBookId } from "./remap";
import { getBookStore, getBookDataStore } from "./stores";
import { syncDebugLog } from "./sync-debug";
import { getCursor, rewindCursor, setCursor } from "./sync-cursors";
import type {
  EntityType,
  SyncCursor,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
} from "./types";
import {
  clearUploadRetry,
  recordUploadFailure,
  runUploadWithRetry,
  shouldAttemptUpload,
  uploadRetryKey,
  type UploadRetryEntry,
} from "./upload-retry";

// Re-export for existing test imports that reach into sync-engine directly.
export { mergeBookRecord, mergeChatSessionRecord };

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
  /** Trigger an immediate pull (e.g. on window focus). */
  triggerPull(): void;
  /**
   * Re-download the book file and cover from the server, overwriting local
   * copies. If the book is missing a remote URL, upload the local file /
   * cover to blob storage instead so the DB row gets populated.
   */
  reloadBookFiles(bookId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Entity types we actively sync (subset of all EntityType values)
// ---------------------------------------------------------------------------

const SYNCABLE_ENTITIES: EntityType[] = [
  "book",
  "position",
  "highlight",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
];

// Server → local record transforms live in ./server-transforms.ts.
// Per-entity merge helpers and the ENTITY_MERGERS map live in ./entity-mergers.ts.

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SyncEngineConfig {
  /** Authenticated user ID. Required for file uploads (used in the blob pathname). */
  userId: string;
  onSyncStart?: () => void;
  onSyncEnd?: (result: { success: boolean }) => void;
  onSyncError?: (error: Error) => void;
  onAuthExpired?: () => void;
}

const PUSH_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 60_000;

/**
 * Maximum number of change log entries to send in a single `/api/sync/push`
 * request. The server processes entries serially with ~1-3 DB trips each,
 * so large batches can hit function timeouts on Vercel. Oversized backlogs
 * are drained across multiple requests scheduled back-to-back.
 */
export const PUSH_BATCH_SIZE = 50;

/**
 * Normalize any caught value from a sync cycle into a real {@link Error}
 * with a non-empty message. Prevents the UI from rendering literals like
 * `"null"` or `"undefined"` when something somewhere rejects with a nullish
 * value. The raw cause is logged to the console for diagnostics whenever
 * the thrown value isn't already an Error.
 */
export function normalizeSyncError(err: unknown): Error {
  if (err instanceof Error) {
    if (!err.message || err.message.trim() === "") {
      const wrapped = new Error("Unknown sync error");
      (wrapped as Error & { cause?: unknown }).cause = err;
      return wrapped;
    }
    return err;
  }

  // Not an Error — log the raw cause so the next occurrence is diagnosable,
  // then coerce to a sensible Error.
  console.error("[sync] non-Error thrown during sync cycle:", err);

  if (err == null) {
    return new Error("Unknown sync error");
  }

  if (typeof err === "string") {
    const trimmed = err.trim();
    return new Error(trimmed === "" ? "Unknown sync error" : trimmed);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(err);
  } catch {
    serialized = String(err);
  }
  if (!serialized || serialized === "{}" || serialized === "null" || serialized === "undefined") {
    return new Error("Unknown sync error");
  }
  return new Error(serialized);
}

export function makeSyncEngine(config: SyncEngineConfig): SyncEngine {
  let pushTimer: ReturnType<typeof setInterval> | null = null;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  // Per-book upload retry state. In-memory only: resets on reload / new engine
  // instance. Prevents the sync loop from hammering the blob endpoint when a
  // particular book's upload keeps failing (e.g. Vercel Blob returning 503).
  const uploadRetryState = new Map<string, UploadRetryEntry>();

  /**
   * Wrapper around {@link uploadFile} that enforces the per-book exponential
   * backoff. On success the retry state for this book+type is cleared; on
   * failure (null return) the next-attempt timestamp is pushed forward along
   * the {@link UPLOAD_BACKOFF_SCHEDULE_MS} schedule.
   */
  async function uploadFileWithBackoff(
    bookId: string,
    data: ArrayBuffer | Blob,
    type: "file" | "cover",
  ): Promise<string | null> {
    const key = uploadRetryKey(bookId, type);
    const decision = shouldAttemptUpload(uploadRetryState, key, Date.now());
    if (!decision.attempt) {
      syncDebugLog("upload-skipped", {
        bookId,
        type,
        retryInMs: decision.retryInMs,
      });
      return null;
    }
    const size = data instanceof Blob ? data.size : data.byteLength;
    syncDebugLog("upload-attempt", { bookId, type, size });
    const url = await uploadFile(bookId, data, type);
    if (url) {
      clearUploadRetry(uploadRetryState, key);
      syncDebugLog("upload-success", { bookId, type, size });
    } else {
      recordUploadFailure(uploadRetryState, key, Date.now());
      syncDebugLog("upload-failed", { bookId, type, size });
    }
    return url;
  }

  async function uploadFile(
    bookId: string,
    data: ArrayBuffer | Blob,
    type: "file" | "cover",
  ): Promise<string | null> {
    const folder = type === "cover" ? "covers" : "books";
    const fileName = type === "cover" ? "cover.jpg" : "book.epub";
    const contentType = type === "cover" ? "image/jpeg" : "application/epub+zip";
    const blob = data instanceof Blob ? data : new Blob([data], { type: contentType });
    const pathname = `${folder}/${config.userId}/${bookId}/${fileName}`;

    const result = await runUploadWithRetry(
      () =>
        upload(pathname, blob, {
          access: "private",
          handleUploadUrl: "/api/sync/files/upload",
          clientPayload: JSON.stringify({ bookId, type }),
          contentType,
        }),
      {
        onAuthExpired: () => config.onAuthExpired?.(),
        onTransientRetry: (attempt, delayMs, err) => {
          console.warn(
            `[sync] File upload transient error for ${bookId} (${type}), attempt ${attempt}, retrying in ${delayMs}ms:`,
            err,
          );
        },
        onGiveUp: (err, totalAttempts) => {
          console.error(
            `[sync] File upload giving up for ${bookId} (${type}) after ${totalAttempts} transient failures:`,
            err,
          );
        },
        onPermanentFailure: (err) => {
          console.error(`[sync] File upload failed for ${bookId} (${type}):`, err);
        },
      },
    );

    return result?.url ?? null;
  }

  /**
   * Scan all books in IDB and upload any that have local file data or cover
   * images but are missing their remote URLs. Runs asynchronously after
   * metadata push — failures are logged but don't block the sync cycle.
   */
  async function uploadPendingFiles(): Promise<void> {
    if (stopped) return;
    // Safety: never attempt uploads before userId is known.
    if (!config.userId) return;

    const bookStore = getBookStore();
    const dataStore = getBookDataStore();
    const allBooks = await entries<string, Record<string, unknown>>(bookStore);

    syncDebugLog("upload-pending-start", { bookCount: allBooks.length });

    for (const entry of allBooks) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const bookId = entry[0];
      const meta = entry[1];
      if (!meta || typeof meta !== "object" || meta.deletedAt) continue;

      // Upload epub file if missing remoteFileUrl
      if (!meta.remoteFileUrl) {
        const fileData = await get<ArrayBuffer>(bookId, dataStore);
        if (fileData) {
          const url = await uploadFileWithBackoff(bookId, fileData, "file");
          if (url) {
            const stamped = {
              ...meta,
              remoteFileUrl: url,
              hasLocalFile: true,
              updatedAt: Date.now(),
            };
            await set(bookId, stamped, bookStore);
            // Enqueue a book change so the URL is carried to the server on
            // the next push. The onUploadCompleted webhook also writes it,
            // but is unreliable; this is the authoritative persistence path.
            recordChange({
              entity: "book",
              entityId: bookId,
              operation: "put",
              data: stamped,
              timestamp: stamped.updatedAt,
            }).catch(console.error);
          }
        }
      }

      // Upload cover image if missing remoteCoverUrl
      if (!meta.remoteCoverUrl && meta.coverImage instanceof Blob) {
        const url = await uploadFileWithBackoff(bookId, meta.coverImage, "cover");
        if (url) {
          // Re-read in case the file upload above already updated meta
          const current = (await get<Record<string, unknown>>(bookId, bookStore)) ?? meta;
          const stamped = {
            ...current,
            remoteCoverUrl: url,
            hasLocalFile: true,
            updatedAt: Date.now(),
          };
          await set(bookId, stamped, bookStore);
          recordChange({
            entity: "book",
            entityId: bookId,
            operation: "put",
            data: stamped,
            timestamp: stamped.updatedAt,
          }).catch(console.error);
        }
      }
    }

    // Notify UI so book list re-renders without stale cloud icons
    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
        );
      });
    }
  }

  /**
   * Re-download file + cover for a single book from the server, overwriting
   * the locally cached copies. If the book is missing `remoteFileUrl` or
   * `remoteCoverUrl`, upload the local file / cover to blob storage so the
   * DB row gets populated (same logic as {@link uploadPendingFiles}, but
   * scoped to one book).
   */
  async function reloadBookFiles(bookId: string): Promise<void> {
    if (!config.userId) return;

    const bookStore = getBookStore();
    const dataStore = getBookDataStore();

    const rawMeta = await get<Record<string, unknown>>(bookId, bookStore);
    if (!rawMeta || typeof rawMeta !== "object" || rawMeta.deletedAt) return;

    syncDebugLog("reload-start", { bookId });

    let meta: Record<string, unknown> = { ...rawMeta };
    let metaChanged = false;

    // --- File ---
    if (meta.remoteFileUrl) {
      try {
        const res = await fetch(
          `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=file`,
          { credentials: "include" },
        );
        if (res.ok) {
          const buf = await res.arrayBuffer();
          await set(bookId, buf, dataStore);
          if (!meta.hasLocalFile) {
            meta = { ...meta, hasLocalFile: true };
            metaChanged = true;
          }
        } else {
          console.error(`[sync] reload file download failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error("[sync] reload file download failed:", err);
      }
    } else {
      const fileData = await get<ArrayBuffer>(bookId, dataStore);
      if (fileData) {
        const url = await uploadFileWithBackoff(bookId, fileData, "file");
        if (url) {
          meta = {
            ...meta,
            remoteFileUrl: url,
            hasLocalFile: true,
            updatedAt: Date.now(),
          };
          metaChanged = true;
          recordChange({
            entity: "book",
            entityId: bookId,
            operation: "put",
            data: meta,
            timestamp: meta.updatedAt as number,
          }).catch(console.error);
        }
      }
    }

    // --- Cover ---
    if (meta.remoteCoverUrl) {
      try {
        const res = await fetch(
          `/api/sync/files/download?bookId=${encodeURIComponent(bookId)}&type=cover`,
          { credentials: "include" },
        );
        if (res.ok) {
          const blob = await res.blob();
          meta = { ...meta, coverImage: blob };
          metaChanged = true;
        } else {
          console.error(`[sync] reload cover download failed: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error("[sync] reload cover download failed:", err);
      }
    } else if (meta.coverImage instanceof Blob) {
      const url = await uploadFileWithBackoff(bookId, meta.coverImage, "cover");
      if (url) {
        meta = {
          ...meta,
          remoteCoverUrl: url,
          updatedAt: Date.now(),
        };
        metaChanged = true;
        recordChange({
          entity: "book",
          entityId: bookId,
          operation: "put",
          data: meta,
          timestamp: meta.updatedAt as number,
        }).catch(console.error);
      }
    }

    if (metaChanged) {
      await set(bookId, meta, bookStore);
    }

    syncDebugLog("reload-end", { bookId, metaChanged });

    if (typeof window !== "undefined") {
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
        );
      });
    }
  }

  async function pushChanges(): Promise<void> {
    if (stopped) return;
    const pending = await getUnsyncedChanges();
    if (pending.length === 0) return;

    // Cap each request at PUSH_BATCH_SIZE so the server handler stays well
    // under Vercel's function timeout. Remaining entries drain on follow-up
    // pushes scheduled below.
    const changes = pending.slice(0, PUSH_BATCH_SIZE);
    const hadFullBatch = changes.length >= PUSH_BATCH_SIZE;

    syncDebugLog("push-start", {
      changeCount: changes.length,
      pendingTotal: pending.length,
    });

    const body: SyncPushRequest = { changes };
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      config.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Push failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPushResponse = await res.json();
    syncDebugLog("push-response", {
      accepted: result.accepted.length,
      rejected: result.rejected?.length ?? 0,
    });
    if (result.accepted.length > 0) {
      await markSynced(result.accepted.map((a) => a.id));
      await clearSyncedChanges();
    }

    // Apply cross-device dedup remaps for any accepted book entries that
    // the server mapped to a canonical id.
    const changesById = new Map(changes.map((c) => [c.id, c]));
    const affectedEntities = new Set<EntityType>();
    for (const entry of result.accepted) {
      if (!entry.canonicalId) continue;
      const change = changesById.get(entry.id);
      if (!change || change.entity !== "book") continue;
      if (change.entityId === entry.canonicalId) continue;
      await remapBookId(change.entityId, entry.canonicalId);
      affectedEntities.add("book");
      affectedEntities.add("position");
      affectedEntities.add("highlight");
      affectedEntities.add("notebook");
      affectedEntities.add("chat_session");
    }
    if (affectedEntities.size > 0 && typeof window !== "undefined") {
      queueMicrotask(() => {
        for (const entity of affectedEntities) {
          window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity } }));
        }
      });
    }

    // Fire-and-forget file uploads after metadata push succeeds
    uploadPendingFiles().catch((err) => console.error("[sync] File upload pass failed:", err));

    // If the batch was full there are (likely) more pending changes. Schedule
    // an immediate follow-up push so a backlog drains quickly without waiting
    // for the interval timer.
    if (hadFullBatch && !stopped) {
      queueMicrotask(() => {
        runCycle(pushChanges);
      });
    }
  }

  async function pullChanges(): Promise<void> {
    if (stopped) return;

    // Send a per-entity cursor map so one entity's lag does not force the
    // others to re-scan. Wire format: `cursors` is a URL-encoded JSON array
    // of SyncCursor (see SyncPullRequest in types.ts). Entities without a
    // stored cursor are omitted; the server defaults them to epoch
    // ("pull from the beginning").
    const cursors: SyncCursor[] = [];
    for (const entity of SYNCABLE_ENTITIES) {
      const cursor = await getCursor(entity);
      if (cursor) cursors.push({ entityType: entity, cursor });
    }

    const params = new URLSearchParams();
    if (cursors.length > 0) {
      params.set("cursors", JSON.stringify(cursors));
    }
    params.set("entityType", SYNCABLE_ENTITIES.join(","));

    syncDebugLog("pull-start", { cursors });

    const res = await fetch(`/api/sync/pull?${params.toString()}`);

    if (res.status === 401) {
      config.onAuthExpired?.();
      return;
    }
    if (!res.ok) {
      throw new Error(`Pull failed: ${res.status} ${res.statusText}`);
    }

    const result: SyncPullResponse = await res.json();

    syncDebugLog("pull-response", {
      groupCount: result.changes.length,
      recordCounts: result.changes.map((g) => ({ entity: g.entity, count: g.records.length })),
    });

    for (const group of result.changes) {
      const merger = ENTITY_MERGERS[group.entity];
      if (!merger) continue;

      for (const record of group.records) {
        await merger(record as Record<string, unknown>);
      }

      // Rewind the server cursor by 1ms before persisting. The server uses
      // strict `>` when filtering by `since`, so advancing to the exact
      // `updatedAt` of the last row would skip any sibling row that shares
      // the same millisecond (common on burst writes). Idempotent mergers
      // make the 1ms overlap safe.
      await setCursor(group.entity, rewindCursor(group.cursor));

      // Dispatch granular per-entity event so only relevant components re-render
      if (group.records.length > 0) {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: group.entity } }),
          );
        });
      }
    }
  }

  async function runCycle(fn: () => Promise<void>): Promise<void> {
    let success = false;
    try {
      config.onSyncStart?.();
      await fn();
      success = true;
    } catch (err) {
      config.onSyncError?.(normalizeSyncError(err));
    } finally {
      config.onSyncEnd?.({ success });
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

    triggerPull() {
      runCycle(pullChanges);
    },

    async reloadBookFiles(bookId: string) {
      await reloadBookFiles(bookId);
    },
  };
}
