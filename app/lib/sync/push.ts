import { listCustody } from "./custody-journal";
import { custodySession } from "./custody-session";
import {
  protectOutgoing,
  restoreJournalChanges,
  receiveJournalRevision,
  acknowledgeJournalProjection,
} from "./delivery-journal";
import { deliveryFingerprint } from "./delivery-fingerprint";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import {
  repairAdoptedDemoSessions,
  rewriteReservedDemoChanges,
} from "~/lib/onboarding/adopt-demo-local";
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
  const session = custodySession(ctx.fileUploadContext.userId);
  return withSyncIdentityLock(async () => {
    session.checkActive();
    session.checkActive();
    if (ctx.isStopped()) return null;
    const ownerId = ctx.fileUploadContext.userId;
    await restoreJournalChanges(ownerId, ctx.isStopped);
    await rewriteReservedDemoChanges(ownerId);
    await resumeBookRemaps(ownerId, { isStopped: ctx.isStopped });
    session.checkActive();
    if (ctx.isStopped()) return null;
    await repairAdoptedDemoSessions(ownerId, ctx.isStopped);
    session.checkActive();
    if (ctx.isStopped()) return null;
    let pending = await getUnsyncedChanges(ownerId);
    if (pending.length === 0) return null;

    const reservedChanges = pending.filter(isReservedDemoChange);
    if (reservedChanges.length > 0) {
      pending = pending.filter((change) => !isReservedDemoChange(change));
      if (pending.length === 0) return null;
    }

    // Cap each request at PUSH_BATCH_SIZE so the server handler stays well
    // under Vercel's function timeout. Remaining entries drain on follow-up
    // pushes scheduled below.
    const now = Date.now();
    let changes = pending
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

    await protectOutgoing(changes, ownerId);
    session.checkActive();
    if (ctx.isStopped()) return null;
    const fingerprints = new Map<string, string>();
    for (const change of changes) {
      try {
        fingerprints.set(change.id, await deliveryFingerprint(change));
      } catch {
        await recordPushFailures(
          [
            {
              id: change.id,
              reason: "Raw snapshot requires local recovery",
              retryable: false,
            },
          ],
          Date.now(),
          [change],
        );
      }
    }
    changes = changes.filter((change) => fingerprints.has(change.id));
    if (!changes.length) {
      pending = (await getUnsyncedChanges(ownerId)).filter(
        (change) => !isReservedDemoChange(change),
      );
      if (pending.some((change) => isChangeReadyToPush(change)) && !ctx.isStopped())
        ctx.scheduleFollowUpPush();
      reportRetainedFailures(pending);
      return null;
    }
    const body: SyncPushRequest = {
      changes,
      supportsRetryableRejections: true,
      supportsDurableReceipts: 1,
    };
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
      session.checkActive();
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

    session.checkActive();
    if (ctx.isStopped()) return null;
    const changesById = new Map(changes.map((change) => [change.id, change]));
    const rejectedById = new Map((result.rejected ?? []).map((entry) => [entry.id, entry]));
    const acceptedIds = result.accepted
      .filter((entry) => changesById.has(entry.id) && !rejectedById.has(entry.id))
      .map((entry) => entry.id);
    const journalItems = await listCustody(ownerId, { omitBinary: true });
    const receivedIds = new Set<string>();
    for (const entry of [...result.accepted, ...(result.rejected ?? [])]) {
      const sent = changesById.get(entry.id);
      if (!sent || result.notReceived?.some((item) => item.id === sent.id)) continue;
      for (const delivery of entry.deliveries ?? []) {
        if (
          await receiveJournalRevision(
            ownerId,
            sent,
            delivery,
            fingerprints.get(sent.id)!,
            journalItems,
          )
        )
          receivedIds.add(sent.id);
      }
    }
    const acceptedIdSet = new Set([
      ...acceptedIds.filter(
        (id) =>
          !result.accepted.find((entry) => entry.id === id)?.deliveries || receivedIds.has(id),
      ),
      ...receivedIds,
    ]);
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
    for (const change of changes) {
      if (acceptedIdSet.has(change.id))
        await acknowledgeJournalProjection(ownerId, change, journalItems);
    }
    await recordPushFailures(failures, Date.now(), changes);
    // The accepted book itself needs no replay; its durable alias now owns
    // recovery. Other accepted snapshots must first be rewritten and republished.
    if (remappedBookIds.length) await markSynced(remappedBookIds, changes);
    await resumeBookRemaps(ownerId, { isStopped: ctx.isStopped });
    session.checkActive();
    if (ctx.isStopped()) return null;
    await repairAdoptedDemoSessions(ownerId, ctx.isStopped);
    if (acceptedIdSet.size > 0) {
      await markSynced([...acceptedIdSet], changes);
      await clearSyncedChanges(
        ownerId,
        changes.filter((change) => receivedIds.has(change.id)),
      );
    }

    // The upload pass scans every local book, so wait until all queued book
    // upserts were accepted before exposing their files to the ownership check.
    pending = (await getUnsyncedChanges(ownerId)).filter((change) => !isReservedDemoChange(change));
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
