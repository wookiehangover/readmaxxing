import { randomUUID } from "node:crypto";
import { sql } from "pg-sql";
import type { PoolClient } from "pg";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { bindResources, inspectOwnership } from "./ownership";
import { canonicalJSON, isEnvelope, snapshotIdentity } from "./identity";
import type { DeliveryReference } from "~/lib/sync/delivery-types";

export interface ReceiptRow {
  entity: string;
  entityId: string;
  receiptId: string;
  accountId: string;
  changeId: string;
  payloadFingerprint: string;
  state: DeliveryReference["state"];
  reasonCode: string;
  decisionVersion: number;
  targetEntityId: string | null;
  originalSnapshot: Record<string, unknown>;
  receivedAt: Date;
  updatedAt: Date;
  sourceClock: unknown;
  originalReferences: Record<string, unknown>;
  nextAttemptAt: Date | null;
  attempts: number;
  leaseToken: string | null;
  leaseUntil: Date | null;
  decisionEvidence: unknown;
  updateSeq: string;
}
export const RECEIPT_METADATA_COLUMNS = sql`entity,entity_id AS "entityId",receipt_id AS "receiptId",account_id AS "accountId",change_id AS "changeId",
 payload_fingerprint AS "payloadFingerprint",state,reason_code AS "reasonCode",decision_version AS "decisionVersion",
 target_entity_id AS "targetEntityId",received_at AS "receivedAt",
 updated_at AS "updatedAt",source_clock AS "sourceClock",
 next_attempt_at AS "nextAttemptAt",attempts,lease_token AS "leaseToken",lease_until AS "leaseUntil",
 decision_evidence AS "decisionEvidence",update_seq::text AS "updateSeq"`;

export const RECEIPT_COLUMNS = sql`${RECEIPT_METADATA_COLUMNS},original_snapshot AS "originalSnapshot",original_references AS "originalReferences"`;

export async function receiveEntry(
  client: PoolClient,
  account: string,
  entry: Record<string, unknown>,
  malformedAlias = false,
) {
  const identity = snapshotIdentity(entry);
  const ownership = await inspectOwnership(client, account, entry);
  if (!ownership.owned) return null;
  await bindResources(client, account, ownership);
  const clock = entry.timestamp;
  const invalidClock =
    typeof clock !== "number" ||
    !Number.isInteger(clock) ||
    !Number.isFinite(new Date(clock).getTime()) ||
    clock > Date.now() + 86_400_000;
  const invalidAlias = malformedAlias || ownership.malformedAlias;
  const future = !invalidClock && (clock as number) > Date.now() + 300_000;
  const state =
    invalidAlias || invalidClock ? "needs_resolution" : future ? "waiting_clock" : "received";
  const reason = invalidAlias
    ? "invalid_alias"
    : invalidClock
      ? "invalid_clock"
      : future
        ? "future_clock"
        : "received";
  const next =
    invalidAlias || invalidClock
      ? null
      : new Date(future ? (clock as number) - 300_000 : Date.now()).toISOString();
  const result = await client.query<ReceiptRow>(sql`INSERT INTO readmax.sync_delivery_receipt
    (receipt_id,account_id,change_id,payload_fingerprint,original_snapshot,source_clock,original_references,payload_bytes,state,reason_code,next_attempt_at)
    VALUES(${randomUUID()},${account},${String(entry.id)},${identity.fingerprint},${identity.json}::jsonb,
      ${canonicalJSON(entry.timestamp ?? null)}::jsonb,${canonicalJSON(ownership.references)}::jsonb,${Buffer.byteLength(identity.json)},
      ${state},
      ${reason},
      ${next}::timestamptz)
    ON CONFLICT(account_id,change_id,fingerprint_version,payload_fingerprint) DO NOTHING RETURNING ${RECEIPT_COLUMNS}`);
  const row =
    result.rows[0] ??
    (
      await client.query<ReceiptRow>(sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt
    WHERE account_id=${account} AND change_id=${String(entry.id)} AND payload_fingerprint=${identity.fingerprint}`)
    ).rows[0];
  if (!row || canonicalJSON(row.originalSnapshot) !== identity.json)
    throw new Error("Receipt identity collision");
  return row;
}
/** Commit every distinct revision before naming its ID in a destructive response. */
export async function receiveBatch(account: string, changes: unknown[]) {
  if (!changes.every(isEnvelope)) throw new TypeError("Unidentifiable mutation envelope");
  return withBookOwnerTransaction(account, async (client) => {
    await client.query(
      sql`INSERT INTO readmax."user"(id) VALUES(${account}) ON CONFLICT(id) DO NOTHING`,
    );
    const groups = new Map<string, typeof changes>();
    for (const entry of changes) groups.set(entry.id, [...(groups.get(entry.id) ?? []), entry]);
    const received: ReceiptRow[] = [];
    const notReceived: string[] = [];
    for (const [id, revisions] of [...groups].sort(
      ([, a], [, b]) => Number(b[0].entity === "book") - Number(a[0].entity === "book"),
    )) {
      const ownership = [];
      for (const entry of revisions) ownership.push(await inspectOwnership(client, account, entry));
      if (ownership.some((item) => !item.owned)) {
        notReceived.push(id);
        continue;
      }
      for (const entry of revisions) {
        const row = await receiveEntry(client, account, entry);
        if (!row) throw new Error("Ownership changed during intake");
        if (!received.some((item) => item.receiptId === row.receiptId)) received.push(row);
      }
    }
    return { received, notReceived };
  });
}
export function deliveryReference(row: ReceiptRow): DeliveryReference {
  return {
    receiptId: row.receiptId,
    fingerprintVersion: 1,
    payloadFingerprint: row.payloadFingerprint,
    state: row.state,
    reasonCode: row.reasonCode,
    decisionVersion: row.decisionVersion,
  };
}
