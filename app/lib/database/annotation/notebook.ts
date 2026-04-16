import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface NotebookRow {
  userId: string;
  bookId: string;
  content: unknown;
  updatedAt: Date;
}

const NOTEBOOK_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  content,
  updated_at AS "updatedAt"
`;

export async function upsertNotebook(
  userId: string,
  bookId: string,
  content: unknown,
  updatedAt: Date,
): Promise<NotebookRow | null> {
  const pool = getPool();
  const result = await pool.query<NotebookRow>(sql`
    INSERT INTO readmax.notebook (user_id, book_id, content, updated_at)
    VALUES (${userId}, ${bookId}, ${JSON.stringify(content)}::jsonb, ${updatedAt.toISOString()})
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.updated_at > readmax.notebook.updated_at
    RETURNING ${NOTEBOOK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getNotebooksByUser(userId: string): Promise<NotebookRow[]> {
  const pool = getPool();
  const result = await pool.query<NotebookRow>(sql`
    SELECT ${NOTEBOOK_COLUMNS}
    FROM readmax.notebook
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `);
  return result.rows;
}

export async function getNotebooksByUserSince(
  userId: string,
  cursor: Date,
): Promise<NotebookRow[]> {
  const pool = getPool();
  const result = await pool.query<NotebookRow>(sql`
    SELECT ${NOTEBOOK_COLUMNS}
    FROM readmax.notebook
    WHERE user_id = ${userId}
      AND updated_at > ${cursor.toISOString()}
    ORDER BY updated_at ASC
  `);
  return result.rows;
}
