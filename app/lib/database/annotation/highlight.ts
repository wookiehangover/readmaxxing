import { sql } from "pg-sql";
import { clampNullableTimestamp, clampUpdatedAt } from "../clamp-timestamp";
import { getPool } from "../pool";

export interface HighlightTextAnchor {
  chapterIndex: number;
  snippet: string;
  offset?: number;
}

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
  textAnchor: HighlightTextAnchor | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  textAnchor?: HighlightTextAnchor | null;
  note?: string | null;
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
  text_anchor AS "textAnchor",
  note,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

export async function upsertHighlight(
  userId: string,
  highlight: UpsertHighlightData,
): Promise<HighlightRow | null> {
  const pool = getPool();
  const textAnchorJson = highlight.textAnchor != null ? JSON.stringify(highlight.textAnchor) : null;
  // Clamp client-provided timestamps so a skewed clock cannot write
  // far-future created_at/deleted_at values (a future deleted_at would match
  // `deleted_at > cursor` on every subsequent pull).
  const createdAtIso = clampUpdatedAt(highlight.createdAt);
  const deletedAtIso = clampNullableTimestamp(highlight.deletedAt);
  const result = await pool.query<HighlightRow>(sql`
    INSERT INTO readmax.highlight (id, user_id, book_id, cfi_range, text, color, page_number, text_offset, text_length, text_anchor, note, created_at, updated_at, deleted_at)
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
      ${textAnchorJson}::jsonb,
      ${highlight.note ?? null},
      ${createdAtIso},
      NOW(),
      ${deletedAtIso}
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          book_id = EXCLUDED.book_id,
          cfi_range = COALESCE(EXCLUDED.cfi_range, readmax.highlight.cfi_range),
          text = EXCLUDED.text,
          color = EXCLUDED.color,
          page_number = EXCLUDED.page_number,
          text_offset = EXCLUDED.text_offset,
          text_length = EXCLUDED.text_length,
          text_anchor = COALESCE(EXCLUDED.text_anchor, readmax.highlight.text_anchor),
          note = COALESCE(EXCLUDED.note, readmax.highlight.note),
          created_at = EXCLUDED.created_at,
          updated_at = NOW(),
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
      AND (updated_at > ${cursor.toISOString()} OR deleted_at > ${cursor.toISOString()})
    ORDER BY updated_at ASC
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
