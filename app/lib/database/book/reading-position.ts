import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { isFurtherAlong } from "~/lib/position-compare";
import { getPool } from "../pool";

export interface ReadingPositionRow {
  userId: string;
  bookId: string;
  cfi: string | null;
  updatedAt: Date;
  cursorTimestamp?: string;
}

const POSITION_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  cfi,
  COALESCE(mutation_at, updated_at) AS "updatedAt"
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
  if (cfi !== existing.cfi && new Date(updatedAt).getTime() === existing.updatedAt.getTime()) {
    throw new Error("Conflicting reading positions share a mutation timestamp");
  }
  return new Date(updatedAt).getTime() > existing.updatedAt.getTime();
}

export async function upsertPosition(
  userId: string,
  bookId: string,
  cfi: string | null,
  updatedAt: Date,
): Promise<ReadingPositionRow | null> {
  const pool = getPool();
  const ts = updatedAt.toISOString();
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

    const result = await client.query<ReadingPositionRow>(sql`
      INSERT INTO readmax.reading_position (user_id, book_id, cfi, updated_at, mutation_at)
      VALUES (${userId}, ${bookId}, ${cfi}, clock_timestamp(), ${ts})
      ON CONFLICT (user_id, book_id) DO UPDATE
        SET cfi = EXCLUDED.cfi,
            updated_at = GREATEST(clock_timestamp(), readmax.reading_position.updated_at + INTERVAL '1 microsecond'),
            mutation_at = GREATEST(EXCLUDED.mutation_at, COALESCE(readmax.reading_position.mutation_at, readmax.reading_position.updated_at))
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

export async function getPositionsByUser(
  userId: string,
  limit?: number,
): Promise<ReadingPositionRow[]> {
  const pool = getPool();
  const result = await pool.query<ReadingPositionRow>(sql`
    SELECT ${POSITION_COLUMNS}
    FROM readmax.reading_position
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getPositionsByUserSince(
  userId: string,
  cursor: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<ReadingPositionRow[]> {
  const pool = getPool();
  const cursorTimestamp = exactCursorTimestamp ?? cursor.toISOString();
  const result = await pool.query<ReadingPositionRow>(sql`
    SELECT ${POSITION_COLUMNS}, updated_at::text AS "cursorTimestamp"
    FROM readmax.reading_position
    WHERE user_id = ${userId}
      AND (
        updated_at > ${cursorTimestamp}
        OR (updated_at = ${cursorTimestamp} AND book_id > ${cursorId ?? null})
      )
    ORDER BY updated_at ASC, book_id ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getPositionForBook(
  userId: string,
  bookId: string,
): Promise<ReadingPositionRow | null> {
  const pool = getPool();
  const result = await pool.query<ReadingPositionRow>(sql`
    SELECT ${POSITION_COLUMNS}
    FROM readmax.reading_position
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}
