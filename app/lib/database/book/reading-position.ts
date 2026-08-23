import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { isFurtherAlong } from "~/lib/position-compare";
import { clampUpdatedAt } from "../clamp-timestamp";
import { getPool } from "../pool";

export interface ReadingPositionRow {
  userId: string;
  bookId: string;
  cfi: string | null;
  updatedAt: Date;
}

const POSITION_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  cfi,
  updated_at AS "updatedAt"
`;

async function lockPosition(client: PoolClient, userId: string, bookId: string): Promise<void> {
  await client.query(sql`
    SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${bookId}))
  `);
}

function shouldReplacePosition(
  existing: ReadingPositionRow,
  cfi: string | null,
  updatedAt: string,
): boolean {
  if (cfi !== null && existing.cfi !== null) {
    if (isFurtherAlong(cfi, existing.cfi)) return true;
    if (isFurtherAlong(existing.cfi, cfi)) return false;
  }
  return new Date(updatedAt).getTime() >= existing.updatedAt.getTime();
}

export async function upsertPosition(
  userId: string,
  bookId: string,
  cfi: string | null,
  updatedAt: Date,
): Promise<ReadingPositionRow | null> {
  const pool = getPool();
  const ts = clampUpdatedAt(updatedAt);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockPosition(client, userId, bookId);
    const existing = await client.query<ReadingPositionRow>(sql`
      SELECT ${POSITION_COLUMNS}
      FROM readmax.reading_position
      WHERE user_id = ${userId}
        AND book_id = ${bookId}
      FOR UPDATE
    `);
    const existingRow = existing.rows[0];

    if (existingRow && !shouldReplacePosition(existingRow, cfi, ts)) {
      await client.query("COMMIT");
      return null;
    }

    const storedUpdatedAt =
      existingRow &&
      cfi !== existingRow.cfi &&
      new Date(ts).getTime() <= existingRow.updatedAt.getTime()
        ? new Date(Math.max(Date.now(), existingRow.updatedAt.getTime() + 1)).toISOString()
        : ts;

    const result = await client.query<ReadingPositionRow>(sql`
      INSERT INTO readmax.reading_position (user_id, book_id, cfi, updated_at)
      VALUES (${userId}, ${bookId}, ${cfi}, ${storedUpdatedAt})
      ON CONFLICT (user_id, book_id) DO UPDATE
        SET cfi = EXCLUDED.cfi,
            updated_at = EXCLUDED.updated_at
      RETURNING ${POSITION_COLUMNS}
    `);
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPositionsByUser(userId: string): Promise<ReadingPositionRow[]> {
  const pool = getPool();
  const result = await pool.query<ReadingPositionRow>(sql`
    SELECT ${POSITION_COLUMNS}
    FROM readmax.reading_position
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `);
  return result.rows;
}

export async function getPositionsByUserSince(
  userId: string,
  cursor: Date,
): Promise<ReadingPositionRow[]> {
  const pool = getPool();
  const result = await pool.query<ReadingPositionRow>(sql`
    SELECT ${POSITION_COLUMNS}
    FROM readmax.reading_position
    WHERE user_id = ${userId}
      AND updated_at > ${cursor.toISOString()}
    ORDER BY updated_at ASC
  `);
  return result.rows;
}
