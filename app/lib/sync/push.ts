import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "./change-log";
import { type FileUploadContext, uploadPendingFiles } from "./file-uploads";
import { remapBookId } from "./remap";
import { syncDebugLog } from "./sync-debug";
import type { EntityType, SyncPushRequest, SyncPushResponse } from "./types";

/**
 * Maximum number of change log entries to send in a single `/api/sync/push`
 * request. The server processes entries serially with ~1-3 DB trips each,
 * so large batches can hit function timeouts on Vercel. Oversized backlogs
 * are drained across multiple requests scheduled back-to-back.
 */
export const PUSH_BATCH_SIZE = 50;

export interface PushContext {
  fileUploadContext: FileUploadContext;
  isStopped: () => boolean;
  onAuthExpired?: () => void;
  /**
   * Called when the sent batch was full, signaling more pending changes may
   * remain. The engine schedules an immediate follow-up push so backlogs
   * drain without waiting for the interval timer.
   */
  scheduleFollowUpPush: () => void;
}

export async function pushChanges(ctx: PushContext): Promise<void> {
  if (ctx.isStopped()) return;
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
    ctx.onAuthExpired?.();
    return;
  }
  if (!res.ok) {
    throw new Error(`Push failed: ${res.status} ${res.statusText}`);
  }

  const result: SyncPushResponse = await res.json();
  const rejected = result.rejected ?? [];
  syncDebugLog("push-response", {
    accepted: result.accepted.length,
    rejected: rejected.length,
  });

  // Drain rejected entries alongside accepted ones so a permanently-rejected
  // entry at the head of the queue cannot starve every later change under
  // the batch cap. Trade-off: transient server-side per-entry errors are
  // therefore not retried in place — the next user mutation creates a new
  // ChangeEntry and drives a fresh push. Rejection reasons are logged so
  // they remain diagnosable.
  for (const entry of rejected) {
    console.warn("[sync] Push entry rejected by server:", entry.id, entry.reason);
  }

  const syncedIds = [...result.accepted.map((a) => a.id), ...rejected.map((r) => r.id)];
  if (syncedIds.length > 0) {
    await markSynced(syncedIds);
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
  uploadPendingFiles(ctx.fileUploadContext, { isStopped: ctx.isStopped }).catch((err) =>
    console.error("[sync] File upload pass failed:", err),
  );

  // If the batch was full there are (likely) more pending changes. Schedule
  // an immediate follow-up push so a backlog drains quickly without waiting
  // for the interval timer.
  if (hadFullBatch && !ctx.isStopped()) {
    ctx.scheduleFollowUpPush();
  }
}
