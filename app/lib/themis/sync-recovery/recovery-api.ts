import type {
  RecoveryDetail,
  RecoveryPage,
  RecoveryResolution,
  DeliverySummary,
} from "~/lib/sync/delivery-types";
import type { RecoveryItem } from "./sync-recovery-types";

/** Owner is captured before the request; the server must reject a changed cookie owner. */
export async function recoveryRequest<T>(
  ownerId: string,
  path = "",
  body?: RecoveryResolution,
): Promise<T> {
  const response = await fetch(`/api/sync/recovery${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "X-Recovery-Owner": ownerId,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "The saved version changed or this action cannot safely apply. Refresh and review both versions again. Your original is retained.",
      );
    if (response.status === 401 || response.status === 403)
      throw new Error("Your account changed. Sign in again and refresh recovery.");
    throw new Error(
      "Could not load or update server recovery. Your original is retained. Try again when connected.",
    );
  }
  const result = await response.json();
  if (result.ownerId !== ownerId)
    throw new Error("Your account changed. Refresh recovery before continuing.");
  return result as T;
}

export function serverRecoveryItem(receipt: DeliverySummary): RecoveryItem {
  return {
    id: `server:${receipt.receiptId}`,
    source: "server",
    sourceId: receipt.receiptId,
    entity: receipt.entity,
    entityId: receipt.entityId,
    state: receipt.state,
    reason: receipt.reasonCode,
    recordedAt: receipt.receivedAt,
    receiptId: receipt.receiptId,
  };
}
export async function listServerRecovery(ownerId: string, checkActive: () => void) {
  const receipts = new Map<string, RecoveryItem>();
  let cursor: string | null = null;
  for (;;) {
    checkActive();
    const page: RecoveryPage = await recoveryRequest(
      ownerId,
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : "",
    );
    checkActive();
    for (const receipt of page.receipts)
      receipts.set(receipt.receiptId, serverRecoveryItem(receipt));
    if (!page.hasMore) return [...receipts.values()];
    if (page.cursor === cursor)
      throw new Error("Recovery list could not advance. Refresh to try again.");
    cursor = page.cursor;
  }
}
export function readServerRecovery(ownerId: string, receiptId: string) {
  return recoveryRequest<RecoveryDetail>(ownerId, `/${encodeURIComponent(receiptId)}`);
}
