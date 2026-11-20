import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "./change-log";
import { type FileUploadContext, uploadPendingFiles } from "./file-uploads";
import { remapBookId } from "./remap";
import { syncDebugLog } from "./sync-debug";
import type { ChangeEntry, EntityType, SyncPushRequest, SyncPushResponse } from "./types";

export const PUSH_BATCH_SIZE = 50;
const MAX_REJECTED_BOOK_PUSH_ATTEMPTS = 3;
const rejectedBookPushAttempts = new Map<string, number>();

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

export interface PushContext {
  fileUploadContext: FileUploadContext;
  isStopped: () => boolean;
  onAuthExpired?: () => void;
  scheduleFollowUpPush: () => void;
}

export async function pushChangesWithResult(ctx: PushContext): Promise<SyncPushResponse | null> {
  if (ctx.isStopped()) return null;
  let pending = await getUnsyncedChanges();
  if (pending.length === 0) return null;

  const reservedChanges = pending.filter(isReservedDemoChange);
  if (reservedChanges.length > 0) {
    await markSynced(reservedChanges.map((change) => change.id));
    await clearSyncedChanges();
    for (const change of reservedChanges) rejectedBookPushAttempts.delete(change.id);
    pending = pending.filter((change) => !isReservedDemoChange(change));
    if (pending.length === 0) return null;
  }

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
    return null;
  }
  if (!res.ok) {
    throw new Error(`Push failed: ${res.status} ${res.statusText}`);
  }

  const result: SyncPushResponse = await res.json();
  const rejected = result.rejected ?? [];
  const changesById = new Map(changes.map((change) => [change.id, change]));
  syncDebugLog("push-response", {
    accepted: result.accepted.length,
    rejected: rejected.length,
  });

  const terminalRejectedIds: string[] = [];
  for (const entry of rejected) {
    const change = changesById.get(entry.id);
    if (change?.entity === "book" && change.operation === "put") {
      const attempts = (rejectedBookPushAttempts.get(entry.id) ?? 0) + 1;
      if (attempts < MAX_REJECTED_BOOK_PUSH_ATTEMPTS) {
        rejectedBookPushAttempts.set(entry.id, attempts);
        console.warn(
          "[sync] Book metadata push rejected; will retry:",
          entry.id,
          change.entityId,
          entry.reason,
        );
        continue;
      }

      rejectedBookPushAttempts.delete(entry.id);
      console.warn(
        "[sync] Book metadata push rejected; retry limit reached:",
        entry.id,
        change.entityId,
        entry.reason,
      );
    } else {
      console.warn("[sync] Push entry rejected by server:", entry.id, entry.reason);
    }
    terminalRejectedIds.push(entry.id);
  }

  const acceptedIds = result.accepted.map((entry) => entry.id);
  for (const id of acceptedIds) {
    rejectedBookPushAttempts.delete(id);
  }

  const syncedIds = [...acceptedIds, ...terminalRejectedIds];
  if (syncedIds.length > 0) {
    await markSynced(syncedIds);
    await clearSyncedChanges();
  }

  const affectedEntities = new Set<EntityType>();
  const bookIdRemaps: Array<{ fromId: string; toId: string }> = [];
  for (const entry of result.accepted) {
    if (!entry.canonicalId) continue;
    const change = changesById.get(entry.id);
    if (!change || change.entity !== "book") continue;
    if (change.entityId === entry.canonicalId) continue;
    await remapBookId(change.entityId, entry.canonicalId);
    bookIdRemaps.push({ fromId: change.entityId, toId: entry.canonicalId });
    affectedEntities.add("book");
    affectedEntities.add("position");
    affectedEntities.add("highlight");
    affectedEntities.add("notebook");
    affectedEntities.add("chat_session");
  }
  if (affectedEntities.size > 0 && typeof window !== "undefined") {
    queueMicrotask(() => {
      for (const entity of affectedEntities) {
        if (entity === "book") {
          for (const bookIdRemap of bookIdRemaps) {
            window.dispatchEvent(
              new CustomEvent("sync:entity-updated", {
                detail: { entity, bookIdRemap },
              }),
            );
          }
        } else {
          window.dispatchEvent(new CustomEvent("sync:entity-updated", { detail: { entity } }));
        }
      }
    });
  }

  const acceptedIdSet = new Set(acceptedIds);
  const hasUnacceptedBookUpsert = pending.some(
    (change) =>
      change.entity === "book" && change.operation === "put" && !acceptedIdSet.has(change.id),
  );
  if (!hasUnacceptedBookUpsert) {
    uploadPendingFiles(ctx.fileUploadContext, { isStopped: ctx.isStopped }).catch((err) =>
      console.error("[sync] File upload pass failed:", err),
    );
  }

  if (hadFullBatch && !ctx.isStopped()) {
    ctx.scheduleFollowUpPush();
  }

  return result;
}

export async function pushChanges(ctx: PushContext): Promise<void> {
  await pushChangesWithResult(ctx);
}
