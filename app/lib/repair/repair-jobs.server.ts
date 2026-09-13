import { getPool } from "~/lib/database/pool";
import type { RepairJob } from "./repair-types";
import { REPAIR_TIMEOUT_MS } from "./repair-types";

const columns = `id, book_id AS "bookId", source_hash AS "sourceHash", status, diagnostics, error`;

export async function expireRepairJobs(userId: string) {
  await getPool().query(
    `UPDATE readmax.book_repair SET status = 'failed', error = 'Repair timed out. You can retry.'
     WHERE user_id = $1 AND status = 'running' AND expires_at < now()`,
    [userId],
  );
  await getPool().query(
    `DELETE FROM readmax.book_repair WHERE user_id = $1 AND created_at < now() - interval '7 days'`,
    [userId],
  );
}

export async function getRepairJob(userId: string, bookId: string, id?: string) {
  await expireRepairJobs(userId);
  const result = await getPool().query<RepairJob>(
    `SELECT ${columns} FROM readmax.book_repair WHERE user_id = $1 AND book_id = $2
     AND ($3::uuid IS NULL OR id = $3) ORDER BY created_at DESC LIMIT 1`,
    [userId, bookId, id ?? null],
  );
  return result.rows[0] ?? null;
}

export async function createRepairJob(userId: string, bookId: string, sourceHash: string) {
  await expireRepairJobs(userId);
  const result = await getPool().query<RepairJob>(
    `INSERT INTO readmax.book_repair (id, user_id, book_id, source_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, 'running', $5) ON CONFLICT DO NOTHING RETURNING ${columns}`,
    [
      crypto.randomUUID(),
      userId,
      bookId,
      sourceHash,
      new Date(Date.now() + REPAIR_TIMEOUT_MS + 30_000),
    ],
  );
  return result.rows[0] ?? null;
}

export async function appendRepairDiagnostic(id: string, message: string) {
  await getPool().query(
    `UPDATE readmax.book_repair SET diagnostics = diagnostics || $2::jsonb
     WHERE id = $1 AND status = 'running' AND jsonb_array_length(diagnostics) < 100`,
    [id, JSON.stringify([message.slice(0, 4000)])],
  );
}

export async function finishRepairJob(id: string, data: Buffer | null, error: string | null) {
  await getPool().query(
    `UPDATE readmax.book_repair SET status = $2, repaired_data = $3, error = $4
     WHERE id = $1 AND status = 'running' AND expires_at > now()`,
    [id, data ? "completed" : "failed", data, error],
  );
}

export async function readRepairOutput(userId: string, bookId: string, id: string) {
  const result = await getPool().query<{ data: Buffer }>(
    `SELECT repaired_data AS data FROM readmax.book_repair
     WHERE id = $1 AND user_id = $2 AND book_id = $3 AND status = 'completed'
     AND created_at > now() - interval '7 days'`,
    [id, userId, bookId],
  );
  return result.rows[0]?.data ?? null;
}
