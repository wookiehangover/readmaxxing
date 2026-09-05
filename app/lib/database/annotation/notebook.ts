import type { PoolClient } from "pg";
import type { JSONContent } from "@tiptap/react";
import { sql } from "pg-sql";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";
import { getPool } from "../pool";

export interface NotebookRow {
  userId: string;
  bookId: string;
  content: unknown;
  updatedAt: Date;
  cursorTimestamp?: string;
}

const NOTEBOOK_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  content,
  COALESCE(mutation_at, updated_at) AS "updatedAt"
`;

export async function upsertNotebook(
  userId: string,
  bookId: string,
  content: unknown,
  updatedAt: Date,
  client?: PoolClient,
): Promise<NotebookRow | null> {
  const pool = client ?? getPool();
  const mutationAt = updatedAt.toISOString();
  const result = await pool.query<NotebookRow>(sql`
    INSERT INTO readmax.notebook (user_id, book_id, content, updated_at, mutation_at)
    VALUES (${userId}, ${bookId}, ${JSON.stringify(content)}::jsonb, clock_timestamp(), ${mutationAt})
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET content = EXCLUDED.content,
          updated_at = GREATEST(clock_timestamp(), readmax.notebook.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at
      WHERE EXCLUDED.mutation_at > COALESCE(readmax.notebook.mutation_at, readmax.notebook.updated_at)
    RETURNING ${NOTEBOOK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getNotebooksByUser(userId: string, limit?: number): Promise<NotebookRow[]> {
  const pool = getPool();
  const result = await pool.query<NotebookRow>(sql`
    SELECT ${NOTEBOOK_COLUMNS}
    FROM readmax.notebook
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getNotebooksByUserSince(
  userId: string,
  cursor: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<NotebookRow[]> {
  const pool = getPool();
  const cursorTimestamp = exactCursorTimestamp ?? cursor.toISOString();
  const result = await pool.query<NotebookRow>(sql`
    SELECT ${NOTEBOOK_COLUMNS}, updated_at::text AS "cursorTimestamp"
    FROM readmax.notebook
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

export async function getNotebookForUser(
  userId: string,
  bookId: string,
  client?: PoolClient,
): Promise<NotebookRow | null> {
  const pool = client ?? getPool();
  const result = await pool.query<NotebookRow>(sql`
    SELECT ${NOTEBOOK_COLUMNS}
    FROM readmax.notebook
    WHERE user_id = ${userId} AND book_id = ${bookId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/**
 * Loads the notebook for a given user/book and returns it as a markdown string.
 * Returns an empty string if no notebook exists or the stored content is not a
 * valid TipTap document.
 */
export async function getNotebookMarkdownForUser(
  userId: string,
  bookId: string,
  client?: PoolClient,
): Promise<string> {
  const row = await getNotebookForUser(userId, bookId, client);
  if (!row || !row.content) return "";
  try {
    return tiptapJsonToMarkdown(row.content as JSONContent);
  } catch (err) {
    console.error("getNotebookMarkdownForUser: failed to convert notebook content", {
      userId,
      bookId,
      error: err,
    });
    return "";
  }
}
