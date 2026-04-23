import { mergeBookRecord, mergeChatMessageRecord, mergeChatSessionRecord } from "./entity-mergers";
import { reloadBookFiles as reloadBookFilesImpl, type FileUploadContext } from "./file-uploads";
import { PUSH_BATCH_SIZE, pushChanges as pushChangesImpl } from "./push";
import { pullChanges as pullChangesImpl } from "./pull";
import type { UploadRetryEntry } from "./upload-retry";

// Re-export for existing test imports that reach into sync-engine directly.
export { mergeBookRecord, mergeChatMessageRecord, mergeChatSessionRecord, PUSH_BATCH_SIZE };

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

  // Shared context threaded into the file-uploads module so all helpers see
  // the same retry Map and auth callback.
  const fileUploadContext: FileUploadContext = {
    userId: config.userId,
    uploadRetryState,
    onAuthExpired: () => config.onAuthExpired?.(),
  };

  const isStopped = () => stopped;

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

  const doPush = () =>
    pushChangesImpl({
      fileUploadContext,
      isStopped,
      onAuthExpired: config.onAuthExpired,
      scheduleFollowUpPush: () => {
        queueMicrotask(() => {
          runCycle(doPush);
        });
      },
    });

  const doPull = () =>
    pullChangesImpl({
      isStopped,
      onAuthExpired: config.onAuthExpired,
    });

  return {
    pushChanges: () => runCycle(doPush),
    pullChanges: () => runCycle(doPull),

    startSync() {
      stopped = false;
      // Immediate pull on start
      runCycle(doPull);
      pushTimer = setInterval(() => runCycle(doPush), PUSH_INTERVAL_MS);
      pullTimer = setInterval(() => runCycle(doPull), PULL_INTERVAL_MS);
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
      runCycle(doPush);
    },

    triggerPull() {
      runCycle(doPull);
    },

    async reloadBookFiles(bookId: string) {
      await reloadBookFilesImpl(fileUploadContext, bookId);
    },
  };
}
