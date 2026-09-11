import { canonicalSnapshot } from "./canonical-version";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { getPool } from "../pool";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { DEFAULT_UPDATED_AT_SKEW_MS } from "../clamp-timestamp";
import { processEntry } from "./apply";
import { inspectOwnership } from "./ownership";
import { RECEIPT_COLUMNS, RECEIPT_METADATA_COLUMNS, type ReceiptRow } from "./intake";
import type { ChangeEntry } from "~/lib/sync/types";
import type { DeliveryState } from "~/lib/sync/delivery-types";

export async function readReceipts(account: string, ids: string[]) {
  if (!ids.length) return [];
  return (
    await getPool()
      .query<ReceiptRow>(sql`SELECT ${RECEIPT_METADATA_COLUMNS} FROM readmax.sync_delivery_receipt
    WHERE account_id=${account} AND receipt_id=ANY(${ids}::uuid[])`)
  ).rows;
}
export async function decide(
  client: PoolClient,
  row: ReceiptRow,
  state: DeliveryState,
  reason: string,
  next: Date | null,
  evidence: unknown = null,
  target: string | null = null,
) {
  await client.query(sql`UPDATE readmax.sync_delivery_receipt SET state=${state},reason_code=${reason},
    next_attempt_at=${next?.toISOString() ?? null}::timestamptz,decision_evidence=${JSON.stringify(evidence)}::jsonb,
    target_entity_id=${target},decision_version=decision_version+1,updated_at=clock_timestamp(),
    update_seq=nextval('readmax.sync_delivery_update_seq'),lease_token=NULL,lease_until=NULL
    WHERE receipt_id=${row.receiptId} AND account_id=${row.accountId}`);
}
function classification(error: unknown, attempts: number) {
  const message = error instanceof Error ? error.message : "";
  const code = (error as { code?: string })?.code;
  if (/Cannot persist .* deletion without/.test(message))
    return {
      state: "waiting_dependency" as const,
      reason: "missing_delete_target",
      next: new Date(Date.now() + 60_000),
    };
  if (
    /Conflicting|timestamp|canonical|Invalid|another user|ownership/i.test(message) ||
    code?.startsWith("22") ||
    code === "23502"
  )
    return {
      state: "needs_resolution" as const,
      reason: /timestamp/.test(message) ? "equal_clock_conflict" : "invalid_or_ambiguous",
      next: null,
    };
  const dependency = code === "23503";
  return {
    state: dependency ? ("waiting_dependency" as const) : ("retry_pending" as const),
    reason: dependency ? "missing_dependency" : "application_unavailable",
    next: new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts, 6))),
  };
}
/** Shared by scheduled delivery and version-checked user resolution. Caller owns transaction. */
export async function applyReceipt(client: PoolClient, row: ReceiptRow) {
  const source = row.originalSnapshot;
  const clock = source.timestamp;
  if (
    typeof clock !== "number" ||
    !Number.isInteger(clock) ||
    !Number.isFinite(new Date(clock).getTime()) ||
    clock > row.receivedAt.getTime() + 86_400_000
  ) {
    await decide(client, row, "needs_resolution", "invalid_clock", null);
    return;
  }
  if (clock > Date.now() + DEFAULT_UPDATED_AT_SKEW_MS) {
    await decide(
      client,
      row,
      "waiting_clock",
      "future_clock",
      new Date(clock - DEFAULT_UPDATED_AT_SKEW_MS),
    );
    return;
  }
  const ownership = await inspectOwnership(client, row.accountId, source);
  if (!ownership.owned || ownership.malformedAlias) {
    await decide(
      client,
      row,
      "needs_resolution",
      ownership.owned ? "invalid_alias" : "ownership_conflict",
      null,
    );
    return;
  }
  if (source.entity !== "book") {
    const books = ownership.resources
      .filter((resource) => resource.namespace === "book")
      .map((resource) => resource.id);
    const blocked = await client.query(sql`SELECT receipt_id FROM readmax.sync_delivery_receipt r
      WHERE account_id=${row.accountId} AND entity='book'
        AND entity_id=ANY(${books}::text[])
        AND state IN ('received','waiting_clock','waiting_dependency','retry_pending','needs_resolution')
        AND NOT EXISTS(SELECT 1 FROM readmax.book existing WHERE existing.id=r.entity_id
          AND existing.user_id=r.account_id)
        AND NOT EXISTS(SELECT 1 FROM readmax.sync_delivery_receipt newer WHERE newer.account_id=r.account_id
          AND newer.entity='book' AND newer.entity_id=r.entity_id
          AND newer.state IN ('applied','covered') AND newer.received_at>r.received_at) LIMIT 1`);
    if (blocked.rows.length) {
      await decide(
        client,
        row,
        "waiting_dependency",
        "pending_parent",
        new Date(Date.now() + 60_000),
      );
      return;
    }
  }
  await client.query("SAVEPOINT delivery_application");
  try {
    const result = await processEntry(
      row.accountId,
      source as unknown as ChangeEntry,
      undefined,
      client,
    );
    if (!result.accepted) {
      await client.query("ROLLBACK TO SAVEPOINT delivery_application");
      await decide(
        client,
        row,
        "needs_resolution",
        source.entity === "chat_message"
          ? "unsupported_legacy_message_write"
          : "unsupported_or_invalid",
        null,
      );
    } else {
      await decide(
        client,
        row,
        result.outcome === "applied" ? "applied" : "covered",
        result.outcome ?? "covered",
        null,
        {
          outcome: result.outcome,
          canonicalId: result.canonicalId,
          sourceClock: clock,
          canonicalVersion: (
            await canonicalSnapshot(client, {
              ...row,
              targetEntityId: result.targetEntityId ?? String(source.entityId),
            })
          ).version,
        },
        result.targetEntityId ?? String(source.entityId),
      );
      await client.query(sql`UPDATE readmax.sync_delivery_receipt r SET next_attempt_at=clock_timestamp()
        WHERE account_id=${row.accountId} AND state='waiting_dependency'
          AND ((entity=${String(source.entity)} AND entity_id=${String(source.entityId)}) OR
            (${source.entity === "book" || source.entity === "chat_session"} AND EXISTS(
              SELECT 1 FROM jsonb_each_text(r.original_references) ref WHERE ref.value=${String(source.entityId)})))`);
    }
    await client.query("RELEASE SAVEPOINT delivery_application");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT delivery_application");
    const result = classification(error, row.attempts);
    await decide(client, row, result.state, result.reason, result.next);
    await client.query("RELEASE SAVEPOINT delivery_application");
  }
}
async function claim(account?: string, excluded: string[] = []) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // One metadata row at a time. Rotating by oldest attempt is account-fair;
    // the invocation excludes accounts after their fifth contribution.
    const result = await client.query<{ receiptId: string; accountId: string }>(sql`
      SELECT receipt_id AS "receiptId",account_id AS "accountId" FROM readmax.sync_delivery_receipt
      WHERE next_attempt_at <= ${new Date(Date.now()).toISOString()}::timestamptz
        AND (lease_until IS NULL OR lease_until <= ${new Date(Date.now()).toISOString()}::timestamptz)
        ${account ? sql`AND account_id=${account}` : sql``}
        AND NOT (account_id=ANY(${excluded}::uuid[]))
      ORDER BY next_attempt_at,received_at,receipt_id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const row = result.rows[0];
    if (!row) {
      await client.query("COMMIT");
      return null;
    }
    const token = randomUUID();
    await client.query(
      sql`UPDATE readmax.sync_delivery_receipt SET lease_token=${token},lease_until=${new Date(Date.now() + 30_000).toISOString()}::timestamptz,attempts=attempts+1 WHERE receipt_id=${row.receiptId}`,
    );
    await client.query("COMMIT");
    return { ...row, token };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function processDeliveries(account?: string) {
  const lock = await getPool().connect();
  let locked = false;
  try {
    const acquired = await lock.query<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_lock(hashtext('sync-delivery-worker')) AS locked`,
    );
    if (!acquired.rows[0]?.locked) return 0;
    locked = true;
    const started = Date.now();
    let processed = 0;
    const counts = new Map<string, number>();
    while (processed < 20 && Date.now() - started < 2000) {
      const item = await claim(
        account,
        [...counts].filter(([, count]) => count >= 5).map(([id]) => id),
      );
      if (!item) break;
      await withBookOwnerTransaction(item.accountId, async (client) => {
        const row = (
          await client.query<ReceiptRow>(sql`SELECT ${RECEIPT_COLUMNS} FROM readmax.sync_delivery_receipt
        WHERE receipt_id=${item.receiptId} AND lease_token=${item.token} AND lease_until > ${new Date(Date.now()).toISOString()}::timestamptz FOR UPDATE`)
        ).rows[0];
        if (row) await applyReceipt(client, row);
      });
      processed++;
      if (!account) counts.set(item.accountId, (counts.get(item.accountId) ?? 0) + 1);
    }
    return processed;
  } finally {
    try {
      if (locked)
        await lock.query(sql`SELECT pg_advisory_unlock(hashtext('sync-delivery-worker'))`);
    } finally {
      lock.release();
    }
  }
}
