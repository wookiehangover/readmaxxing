import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import {
  clearSyncedChanges,
  getUnsyncedChanges,
  isChangeReadyToPush,
  markSynced,
  recordPushFailures,
} from "./change-log";
import { type FileUploadContext, uploadPendingFiles } from "./file-uploads";
import { persistBookRemap, resumeBookRemaps } from "./remap-journal";
import { syncDebugLog } from "./sync-debug";
import { withSyncIdentityLock } from "./sync-lock";
import type { ChangeEntry, SyncPushRequest, SyncPushResponse } from "./types";

/**
 * Maximum number of change log entries to send in a single `/api/sync/push`
 * request. The server processes entries serially with ~1-3 DB trips each,
 * so large batches can hit function timeouts on Vercel. Oversized backlogs
 * are drained across multiple requests scheduled back-to-back.
 */
export const PUSH_BATCH_SIZE = 50;

function isReservedDemoChange(change: ChangeEntry): boolean {
  if (change.entityId === DEMO_BOOK_ID || change.entityId === DEMO_CHAT_SESSION.id) return true;
  if (!change.data || typeof change.data !== "object") return false;

  const data = change.data as Record<string, unknown>;
  return (
    data.id === DEMO_BOOK_ID ||
    data.id === DEMO_CHAT_SESSION.id ||
    data.bookId === DEMO_BOOK_ID ||
    data.sessionId === DEMO_CHAT_SESSION.id
  );
}

/** A completed push left durable failures; unrelated owned files may still recover. */
export class PushRejectedError extends Error {}

function reportRetainedFailures(pending: ChangeEntry[]): void {
  const failed = pending.filter((change) => change.failure);
  if (failed.length === 0) return;
  const first = failed[0];
  throw new PushRejectedError(
    `Push incomplete: ${failed.length} retained change(s). ${first.entity} ${first.entityId}: ${first.failure!.reason}`,
  );
}

export interface PushContext {
  fileUploadContext: FileUploadContext;
  isStopped: () => boolean;
  onAuthExpired?: () => void;
  /**
   * Called when eligible changes remain, including mutations created during
   * this request. Failed entries wait for their persisted retry deadline.
   */
  scheduleFollowUpPush: () => void;
}

export async function pushChangesWithResult(ctx: PushContext): Promise<SyncPushResponse | null> {
  return withSyncIdentityLock(async () => {
    if (ctx.isStopped()) return null;
    const ownerId = ctx.fileUploadContext.userId;
    await resumeBookRemaps(ownerId, { isStopped: ctx.isStopped });
    if (ctx.isStopped()) return null;
    let pending = await getUnsyncedChanges(ownerId);
    if (pending.length === 0) return null;

    const reservedChanges = pending.filter(isReservedDemoChange);
    if (reservedChanges.length > 0) {
      await markSynced(
        reservedChanges.map((change) => change.id),
        reservedChanges,
      );
      await clearSyncedChanges();
      pending = pending.filter((change) => !isReservedDemoChange(change));
      if (pending.length === 0) return null;
    }

    // Cap each request at PUSH_BATCH_SIZE so the server handler stays well
    // under Vercel's function timeout. Remaining entries drain on follow-up
    // pushes scheduled below.
    const now = Date.now();
    const changes = pending
      .filter((change) => isChangeReadyToPush(change, now))
      .slice(0, PUSH_BATCH_SIZE);
    if (changes.length === 0) {
      reportRetainedFailures(pending);
      return null;
    }

    syncDebugLog("push-start", {
      changeCount: changes.length,
      pendingTotal: pending.length,
    });

    const body: SyncPushRequest = { changes, supportsRetryableRejections: true };
    let result: SyncPushResponse;
    let authExpired = false;
    try {
      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        authExpired = true;
        ctx.onAuthExpired?.();
        throw new Error("Push failed: authentication expired");
      }
      if (!res.ok) throw new Error(`Push failed: ${res.status} ${res.statusText}`);
      result = await res.json();
      if (!Array.isArray(result.accepted)) throw new Error("Push response missing acknowledgments");
    } catch (err) {
      // An unknown HTTP/network outcome is not an acknowledgment. Keep all data.
      // Authentication can retry immediately once the session is restored.
      if (!authExpired && !ctx.isStopped()) {
        await recordPushFailures(
          changes.map((change) => ({
            id: change.id,
            reason: err instanceof Error ? err.message : "Push failed",
            retryable: true,
          })),
          Date.now(),
          changes,
        );
      }
      throw err;
    }

    if (ctx.isStopped()) return null;
    const changesById = new Map(changes.map((change) => [change.id, change]));
    const rejectedById = new Map((result.rejected ?? []).map((entry) => [entry.id, entry]));
    const acceptedIds = result.accepted
      .filter((entry) => changesById.has(entry.id) && !rejectedById.has(entry.id))
      .map((entry) => entry.id);
    const acceptedIdSet = new Set(acceptedIds);
    const failures = changes
      .filter((change) => !acceptedIdSet.has(change.id))
      .map(
        (change) =>
          rejectedById.get(change.id) ?? {
            id: change.id,
            reason: "Server did not acknowledge change",
            retryable: true,
          },
      );
    syncDebugLog("push-response", { accepted: acceptedIds.length, rejected: failures.length });
    for (const entry of failures) {
      console.warn("[sync] Push entry retained after failure:", entry.id, entry.reason);
    }
    // Persist canonical evidence BEFORE any acknowledgment can remove it. Old
    // servers may accept dependents under the losing ID in this same batch.
    const remappedBookIds: string[] = [];
    for (const entry of result.accepted) {
      const change = changesById.get(entry.id);
      if (
        !entry.canonicalId ||
        !acceptedIdSet.has(entry.id) ||
        change?.entity !== "book" ||
        change.entityId === entry.canonicalId
      )
        continue;
      await persistBookRemap(ownerId, change.entityId, entry.canonicalId);
      remappedBookIds.push(entry.id);
    }
    await recordPushFailures(failures, Date.now(), changes);
    // The accepted book itself needs no replay; its durable alias now owns
    // recovery. Other accepted snapshots must first be rewritten and republished.
    if (remappedBookIds.length) await markSynced(remappedBookIds, changes);
    await resumeBookRemaps(ownerId, { isStopped: ctx.isStopped });
    if (ctx.isStopped()) return null;
    if (acceptedIds.length > 0) {
      await markSynced(acceptedIds, changes);
      await clearSyncedChanges();
    }

    // The upload pass scans every local book, so wait until all queued book
    // upserts were accepted before exposing their files to the ownership check.
    pending = await getUnsyncedChanges(ownerId);
    const hasUnacceptedBookUpsert = pending.some(
      (change) => change.entity === "book" && change.operation === "put",
    );
    if (!hasUnacceptedBookUpsert) {
      uploadPendingFiles(ctx.fileUploadContext, { isStopped: ctx.isStopped }).catch((err) =>
        console.error("[sync] File upload pass failed:", err),
      );
    }

    // Rereading the outbox also preserves mutations recorded while fetch was in
    // flight. Deferred/permanent failures never occupy the next batch's slots.
    if (pending.some((change) => isChangeReadyToPush(change)) && !ctx.isStopped()) {
      ctx.scheduleFollowUpPush();
    }
    reportRetainedFailures(pending);

    return result;
  });
}

export async function pushChanges(ctx: PushContext): Promise<void> {
  await pushChangesWithResult(ctx);
}
