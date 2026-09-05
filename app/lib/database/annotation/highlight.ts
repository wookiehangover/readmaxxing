import type { PoolClient } from "pg";
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
  cursorTimestamp?: string;
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
  updatedAt?: Date;
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
  COALESCE(mutation_at, updated_at) AS "updatedAt",
  deleted_at AS "deletedAt"
`;

export async function upsertHighlight(
  userId: string,
  highlight: UpsertHighlightData,
  client?: PoolClient,
): Promise<HighlightRow | null> {
  const pool = client ?? getPool();
  const textAnchorJson = highlight.textAnchor != null ? JSON.stringify(highlight.textAnchor) : null;
  // Use the original mutation clock so clamped metadata stays identical on replay.
  const mutationAt = (highlight.updatedAt ?? highlight.createdAt).toISOString();
  const sourceTime = Date.parse(mutationAt);
  const createdAtIso = clampUpdatedAt(highlight.createdAt, undefined, sourceTime);
  const deletedAtIso = clampNullableTimestamp(highlight.deletedAt, undefined, sourceTime);
  const result = await pool.query<HighlightRow>(sql`
    INSERT INTO readmax.highlight (id, user_id, book_id, cfi_range, text, color, page_number, text_offset, text_length, text_anchor, note, created_at, updated_at, deleted_at, mutation_at)
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
      ${deletedAtIso},
      ${mutationAt}
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
          updated_at = GREATEST(clock_timestamp(), readmax.highlight.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at,
          deleted_at = EXCLUDED.deleted_at
      WHERE readmax.highlight.user_id = EXCLUDED.user_id
        AND ((EXCLUDED.deleted_at IS NOT NULL
                AND (readmax.highlight.deleted_at IS NULL OR EXCLUDED.deleted_at > readmax.highlight.deleted_at))
          OR (EXCLUDED.deleted_at IS NULL AND readmax.highlight.deleted_at IS NULL
                AND EXCLUDED.mutation_at > COALESCE(readmax.highlight.mutation_at, readmax.highlight.updated_at)))
    RETURNING ${HIGHLIGHT_COLUMNS}
  `);

  if (result.rows.length === 0) {
    // Old producers can reuse a millisecond for distinct edits. Without a
    // later source clock, retaining the conflict is safer than acknowledging
    // data we did not store or allowing retries to overwrite each other.
    const collision = await pool.query(sql`
      SELECT id FROM readmax.highlight
      WHERE id = ${highlight.id} AND user_id = ${userId}
        AND deleted_at IS NULL AND ${deletedAtIso}::timestamptz IS NULL
        AND COALESCE(mutation_at, updated_at) = ${mutationAt}
        AND (book_id IS DISTINCT FROM ${highlight.bookId}
          OR cfi_range IS DISTINCT FROM COALESCE(${highlight.cfiRange ?? null}, cfi_range)
          OR text IS DISTINCT FROM ${highlight.text ?? null}
          OR color IS DISTINCT FROM ${highlight.color ?? null}
          OR page_number IS DISTINCT FROM ${highlight.pageNumber ?? null}
          OR text_offset IS DISTINCT FROM ${highlight.textOffset ?? null}
          OR text_length IS DISTINCT FROM ${highlight.textLength ?? null}
          OR text_anchor IS DISTINCT FROM COALESCE(${textAnchorJson}::jsonb, text_anchor)
          OR created_at IS DISTINCT FROM ${createdAtIso}::timestamptz
          OR note IS DISTINCT FROM COALESCE(${highlight.note ?? null}, note))
    `);
    if (collision.rows.length > 0)
      throw new Error("Conflicting highlight edits share a mutation timestamp");
    return null;
  }
  return result.rows[0];
}

export async function getHighlightsByUser(
  userId: string,
  limit?: number,
  client?: PoolClient,
): Promise<HighlightRow[]> {
  const pool = client ?? getPool();
  const result = await pool.query<HighlightRow>(sql`
    SELECT ${HIGHLIGHT_COLUMNS}
    FROM readmax.highlight
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getHighlightsByUserSince(
  userId: string,
  cursor: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<HighlightRow[]> {
  const pool = getPool();
  const cursorTimestamp = exactCursorTimestamp ?? cursor.toISOString();
  const result = await pool.query<HighlightRow>(sql`
    SELECT ${HIGHLIGHT_COLUMNS}, updated_at::text AS "cursorTimestamp"
    FROM readmax.highlight
    WHERE user_id = ${userId}
      AND (
        updated_at > ${cursorTimestamp}
        OR (updated_at = ${cursorTimestamp} AND id > ${cursorId ?? null})
      )
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function softDeleteHighlight(
  userId: string,
  highlightId: string,
  deletedAt?: Date,
  client?: PoolClient,
): Promise<boolean> {
  const pool = client ?? getPool();
  const mutationAt = (deletedAt ?? new Date()).toISOString();
  const result = await pool.query(sql`
    UPDATE readmax.highlight
    SET deleted_at = ${mutationAt},
        updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond'),
        mutation_at = ${mutationAt}
    WHERE id = ${highlightId}
      AND user_id = ${userId}
      AND (deleted_at IS NULL OR ${mutationAt}::timestamptz > deleted_at)
  `);
  if (deletedAt && !result.rowCount) {
    // Legacy deletes can lack the book ID needed to insert a tombstone. Keep
    // the mutation retryable until its target exists instead of losing it.
    const existing = await pool.query(sql`
      SELECT id FROM readmax.highlight WHERE id = ${highlightId} AND user_id = ${userId}
    `);
    if (existing.rows.length === 0)
      throw new Error("Cannot persist highlight deletion without its book ID");
  }
  return (result.rowCount ?? 0) > 0;
}
