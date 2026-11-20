import { mergeBookRecord, mergeChatMessageRecord, mergeChatSessionRecord } from "./entity-mergers";
import { reuploadBookChapters } from "./book-chapter-uploads";
import { getUnsyncedChanges } from "./change-log";
import {
  reloadBookFiles as reloadBookFilesImpl,
  resetUploadBackoff,
  uploadPendingFiles,
  type FileUploadContext,
} from "./file-uploads";
import {
  PUSH_BATCH_SIZE,
  pushChanges as pushChangesImpl,
  pushChangesWithResult,
  type PushContext,
} from "./push";
import { pullChanges as pullChangesImpl } from "./pull";
import type { UploadRetryEntry } from "./upload-retry";

export { mergeBookRecord, mergeChatMessageRecord, mergeChatSessionRecord, PUSH_BATCH_SIZE };

export interface SyncEngine {
  pushChanges(): Promise<void>;
  pullChanges(): Promise<void>;
  startSync(): void;
  stopSync(): void;
  triggerPush(): void;
  triggerManualPush(): Promise<void>;
  triggerPull(): void;
  reloadBookFiles(bookId: string): Promise<void>;
}

export interface SyncEngineConfig {
  userId: string;
  onSyncStart?: () => void;
  onSyncEnd?: (result: { success: boolean }) => void;
  onSyncError?: (error: Error) => void;
  onAuthExpired?: () => void;
}

const PUSH_INTERVAL_MS = 30_000;
const PULL_INTERVAL_MS = 60_000;

export function normalizeSyncError(err: unknown): Error {
  if (err instanceof Error) {
    if (!err.message || err.message.trim() === "") {
      const wrapped = new Error("Unknown sync error");
      (wrapped as Error & { cause?: unknown }).cause = err;
      return wrapped;
    }
    return err;
  }

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

  const uploadRetryState = new Map<string, UploadRetryEntry>();

  const fileUploadContext: FileUploadContext = {
    userId: config.userId,
    uploadRetryState,
    onAuthExpired: () => config.onAuthExpired?.(),
  };

  const isStopped = () => stopped;

  async function runCycle(fn: () => Promise<void>, rethrow = false): Promise<void> {
    let success = false;
    try {
      config.onSyncStart?.();
      await fn();
      success = true;
    } catch (err) {
      const error = normalizeSyncError(err);
      config.onSyncError?.(error);
      if (rethrow) throw error;
    } finally {
      config.onSyncEnd?.({ success });
    }
  }

  const pushContext: PushContext = {
    fileUploadContext,
    isStopped,
    onAuthExpired: config.onAuthExpired,
    scheduleFollowUpPush: () => {
      queueMicrotask(() => {
        runCycle(doPush);
      });
    },
  };

  const doPush = () => pushChangesImpl(pushContext);

  const doPull = () =>
    pullChangesImpl({
      isStopped,
      onAuthExpired: config.onAuthExpired,
    });

  const doRecoverFiles = async () => {
    const pushResult = await pushChangesWithResult(pushContext);
    const hasUnacceptedBookPut =
      pushResult !== null &&
      (await getUnsyncedChanges()).some(
        (change) => change.entity === "book" && change.operation === "put",
      );

    if (!hasUnacceptedBookPut) {
      resetUploadBackoff(fileUploadContext);
      await uploadPendingFiles(fileUploadContext, {
        isStopped,
        verifyExistingRemoteUrls: true,
      });
    }

    await doPush();
  };

  return {
    pushChanges: () => runCycle(doPush),
    pullChanges: () => runCycle(doPull, true),

    startSync() {
      stopped = false;
      runCycle(doPull);
      runCycle(doRecoverFiles);
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

    triggerManualPush: () => runCycle(doRecoverFiles, true),

    triggerPull() {
      runCycle(doPull);
    },

    async reloadBookFiles(bookId: string) {
      await reloadBookFilesImpl(fileUploadContext, bookId);
      await reuploadBookChapters(bookId);
    },
  };
}
