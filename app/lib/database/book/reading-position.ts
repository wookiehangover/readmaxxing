import { sql } from "pg-sql";
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

export async function upsertPosition(
  userId: string,
  bookId: string,
  cfi: string | null,
  updatedAt: Date,
): Promise<ReadingPositionRow | null> {
  const pool = getPool();
  const result = await pool.query<ReadingPositionRow>(sql`
    INSERT INTO readmax.reading_position (user_id, book_id, cfi, updated_at)
    VALUES (${userId}, ${bookId}, ${cfi}, ${updatedAt.toISOString()})
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET cfi = EXCLUDED.cfi,
          updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.updated_at > readmax.reading_position.updated_at
    RETURNING ${POSITION_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
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
