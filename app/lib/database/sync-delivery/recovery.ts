import { canonicalSnapshot, CanonicalOwnershipConflict } from "./canonical-version";
import { sql } from "pg-sql";
import { getPool } from "../pool";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { canonicalJSON, isEnvelope } from "./identity";
import {
  RECEIPT_COLUMNS,
  RECEIPT_METADATA_COLUMNS,
  receiveEntry,
  deliveryReference,
  type ReceiptRow,
} from "./intake";
import { applyReceipt, decide } from "./worker";
import type {
  DeliverySummary,
  RecoveryDetail,
  RecoveryPage,
  RecoveryResolution,
} from "~/lib/sync/delivery-types";
export function summary(row: ReceiptRow): DeliverySummary {
  return {
    ...deliveryReference(row),
    ownerId: row.accountId,
    changeId: row.changeId,
    entity: row.entity,
    entityId: row.entityId,
    sourceClock: row.sourceClock,
    receivedAt: row.receivedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    targetEntityId: row.targetEntityId,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    attachments:
      row.entity === "book"
        ? [
            { kind: "file", state: "not_received" },
            { kind: "cover", state: "not_received" },
          ]
        : [],
  };
}
export async function getRecovery(account: string, id: string): Promise<RecoveryDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withBookOwnerTransaction(
    account,
    async (client) => {
      const row = (
        await client.query<ReceiptRow>(
          sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt WHERE account_id=${account} AND receipt_id=${id}`,
        )
      ).rows[0];
      if (!row) return null;
      let canonical;
      try {
        const { exists: _exists, ...snapshot } = await canonicalSnapshot(client, row, false);
        canonical = {
          ...snapshot,
          entityId: ["unavailable", "unsupported"].includes(snapshot.status)
            ? null
            : snapshot.entityId,
        };
      } catch (error) {
        if (error instanceof CanonicalOwnershipConflict) return null;
        throw error;
      }
      return {
        ...summary(row),
        originalSnapshot: row.originalSnapshot,
        originalReferences: row.originalReferences,
        decisionEvidence: row.decisionEvidence,
        canonicalVersion: canonical.version,
        canonical,
      };
    },
    undefined,
    "repeatable read",
  );
}
export async function listRecovery(
  account: string,
  cursor: string | null,
  limit = 50,
): Promise<RecoveryPage> {
  let after = "0";
  if (cursor) {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
      account: string;
      after: string;
    };
    if (value.account !== account || !/^\d+$/.test(value.after))
      throw new TypeError("Invalid cursor");
    after = value.after;
  }
  // update_seq changes for every decision, so reusing the terminal cursor sees resolutions too.
  const rows = (
    await getPool()
      .query<ReceiptRow>(sql`SELECT ${RECEIPT_METADATA_COLUMNS} FROM readmax.sync_delivery_receipt
    WHERE account_id=${account} AND update_seq>${after}::bigint ORDER BY update_seq LIMIT ${limit + 1}`)
  ).rows;
  const page = rows.slice(0, limit);
  return {
    ownerId: account,
    receipts: page.map(summary),
    hasMore: rows.length > limit,
    cursor: Buffer.from(
      JSON.stringify({ account, after: page.at(-1)?.updateSeq ?? after }),
    ).toString("base64url"),
  };
}
export class RecoveryConflict extends Error {}
export async function resolveRecovery(account: string, id: string, request: RecoveryResolution) {
  return withBookOwnerTransaction(account, async (client) => {
    const prior = (
      await client.query<{
        request: unknown;
        result: DeliverySummary;
      }>(sql`SELECT request,result FROM readmax.sync_delivery_resolution
      WHERE account_id=${account} AND resolution_id=${request.resolutionId}`)
    ).rows[0];
    if (prior) {
      if (canonicalJSON(prior.request) !== canonicalJSON({ receiptId: id, ...request }))
        throw new RecoveryConflict("Resolution identity reused");
      // Older persisted decisions predate the response account echo.
      return { ...prior.result, ownerId: account };
    }
    const row = (
      await client.query<ReceiptRow>(sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt
      WHERE account_id=${account} AND receipt_id=${id} FOR UPDATE`)
    ).rows[0];
    if (!row) return null;
    if (
      row.decisionVersion !== request.expectedDecisionVersion ||
      (await canonicalSnapshot(client, row)).version !== request.expectedCanonicalVersion
    )
      throw new RecoveryConflict("Recovery state changed");
    if (request.action === "keep_canonical")
      await decide(client, row, "resolved", "kept_canonical", null, {
        resolutionId: request.resolutionId,
      });
    else if (request.action === "retry") {
      const projection = row.originalSnapshot.recoveryProjection as
        | { requiresNewEdit?: unknown }
        | undefined;
      if (projection?.requiresNewEdit)
        throw new RecoveryConflict("Projected local content requires a new reviewed edit");
      await applyReceipt(client, row);
    } else if (request.action === "restore_copy" || request.action === "submit_edit") {
      const change = request.newMutation;
      if (
        !isEnvelope(change) ||
        change.id === row.changeId ||
        change.entity !== row.originalSnapshot.entity ||
        change.operation !== "put" ||
        !Number.isInteger(change.timestamp) ||
        Math.abs(Date.now() - change.timestamp) > 300_000 ||
        (request.action === "restore_copy" && change.entityId === row.originalSnapshot.entityId)
      )
        throw new RecoveryConflict("A new user mutation is required");
      const received = await receiveEntry(
        client,
        account,
        change as unknown as Record<string, unknown>,
      );
      if (!received) throw new RecoveryConflict("Mutation not received");
      const target = await canonicalSnapshot(client, received);
      const original = await canonicalSnapshot(client, row);
      if (
        (request.action === "restore_copy" &&
          (target.exists || target.entityId === original.entityId)) ||
        (request.action === "submit_edit" && target.entityId !== original.entityId)
      )
        throw new RecoveryConflict("Recovery target does not match the requested action");
      await applyReceipt(client, received);
      const applied = (
        await client.query<ReceiptRow>(
          sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt WHERE receipt_id=${received.receiptId}`,
        )
      ).rows[0];
      const actualTarget = await canonicalSnapshot(client, applied);
      // Explicit edits/copies need a performed write at the requested target.
      // Ordinary replay coverage and deduplication are still valid push outcomes.
      if (
        applied.state !== "applied" ||
        !actualTarget.exists ||
        actualTarget.entityId !== target.entityId
      )
        throw new RecoveryConflict("New edit cannot safely apply");
      await decide(client, row, "resolved", request.action, null, {
        resolutionId: request.resolutionId,
        newReceiptId: received.receiptId,
      });
    } else throw new TypeError("Invalid resolution action");
    const updated = (
      await client.query<ReceiptRow>(
        sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt WHERE receipt_id=${id}`,
      )
    ).rows[0];
    const result = summary(updated);
    await client.query(sql`INSERT INTO readmax.sync_delivery_resolution(account_id,resolution_id,receipt_id,request,result)
      VALUES(${account},${request.resolutionId},${id},${canonicalJSON({ receiptId: id, ...request })}::jsonb,${JSON.stringify(result)}::jsonb)`);
    return result;
  });
}
