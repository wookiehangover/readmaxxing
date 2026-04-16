import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface HighlightRow {
  id: string;
  userId: string;
  bookId: string;
  cfiRange: string | null;
  text: string | null;
  color: string | null;
  pageNumber: number | null;
  textOffset: number | null;
  textLength: number | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface UpsertHighlightData {
  id: string;
  bookId: string;
  cfiRange?: string | null;
  text?: string | null;
  color?: string | null;
  pageNumber?: number | null;
  textOffset?: number | null;
  textLength?: number | null;
  createdAt: Date;
  deletedAt?: Date | null;
}

const HIGHLIGHT_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  cfi_range AS "cfiRange",
  text,
  color,
  page_number AS "pageNumber",
  text_offset AS "textOffset",
  text_length AS "textLength",
  created_at AS "createdAt",
  deleted_at AS "deletedAt"
`;

export async function upsertHighlight(
  userId: string,
  highlight: UpsertHighlightData,
): Promise<HighlightRow | null> {
  const pool = getPool();
  const result = await pool.query<HighlightRow>(sql`
    INSERT INTO readmax.highlight (id, user_id, book_id, cfi_range, text, color, page_number, text_offset, text_length, created_at, deleted_at)
    VALUES (
      ${highlight.id},
      ${userId},
      ${highlight.bookId},
      ${highlight.cfiRange ?? null},
      ${highlight.text ?? null},
      ${highlight.color ?? null},
      ${highlight.pageNumber ?? null},
      ${highlight.textOffset ?? null},
      ${highlight.textLength ?? null},
      ${highlight.createdAt.toISOString()},
      ${highlight.deletedAt?.toISOString() ?? null}
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          book_id = EXCLUDED.book_id,
          cfi_range = EXCLUDED.cfi_range,
          text = EXCLUDED.text,
          color = EXCLUDED.color,
          page_number = EXCLUDED.page_number,
          text_offset = EXCLUDED.text_offset,
          text_length = EXCLUDED.text_length,
          created_at = EXCLUDED.created_at,
          deleted_at = EXCLUDED.deleted_at
    RETURNING ${HIGHLIGHT_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getHighlightsByUser(userId: string): Promise<HighlightRow[]> {
  const pool = getPool();
  const result = await pool.query<HighlightRow>(sql`
    SELECT ${HIGHLIGHT_COLUMNS}
    FROM readmax.highlight
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `);
  return result.rows;
}

export async function getHighlightsByUserSince(
  userId: string,
  cursor: Date,
): Promise<HighlightRow[]> {
  const pool = getPool();
  const result = await pool.query<HighlightRow>(sql`
    SELECT ${HIGHLIGHT_COLUMNS}
    FROM readmax.highlight
    WHERE user_id = ${userId}
      AND (created_at > ${cursor.toISOString()} OR deleted_at > ${cursor.toISOString()})
    ORDER BY created_at ASC
  `);
  return result.rows;
}

export async function softDeleteHighlight(userId: string, highlightId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.highlight
    SET deleted_at = NOW()
    WHERE id = ${highlightId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}
