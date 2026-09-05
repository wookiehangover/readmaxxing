import { sql } from "pg-sql";
import { clampNullableTimestamp, clampUpdatedAt } from "../clamp-timestamp";
import { getPool } from "../pool";

export interface BookmarkRow {
  id: string;
  userId: string;
  bookId: string;
  cfi: string | null;
  label: string | null;
  pageNumber: number | null;
  displayPage: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  cursorTimestamp?: string;
}

export interface UpsertBookmarkData {
  id: string;
  bookId: string;
  cfi?: string | null;
  label?: string | null;
  pageNumber?: number | null;
  displayPage?: number | null;
  createdAt: Date;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
}

const BOOKMARK_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  cfi,
  label,
  page_number AS "pageNumber",
  display_page AS "displayPage",
  created_at AS "createdAt",
  COALESCE(mutation_at, updated_at) AS "updatedAt",
  deleted_at AS "deletedAt"
`;

export async function upsertBookmark(
  userId: string,
  bookmark: UpsertBookmarkData,
): Promise<BookmarkRow | null> {
  const pool = getPool();
  const mutationAt = (bookmark.updatedAt ?? bookmark.createdAt).toISOString();
  // Clamp created_at/deleted_at too: a far-future deleted_at would match
  // `deleted_at > cursor` on every subsequent pull.
  const createdAtIso = clampUpdatedAt(bookmark.createdAt);
  const deletedAtIso = clampNullableTimestamp(bookmark.deletedAt);
  const result = await pool.query<BookmarkRow>(sql`
    INSERT INTO readmax.bookmark (id, user_id, book_id, cfi, label, page_number, display_page, created_at, updated_at, deleted_at, mutation_at)
    VALUES (
      ${bookmark.id},
      ${userId},
      ${bookmark.bookId},
      ${bookmark.cfi ?? null},
      ${bookmark.label ?? null},
      ${bookmark.pageNumber ?? null},
      ${bookmark.displayPage ?? null},
      ${createdAtIso},
      clock_timestamp(),
      ${deletedAtIso},
      ${mutationAt}
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          book_id = EXCLUDED.book_id,
          cfi = EXCLUDED.cfi,
          label = EXCLUDED.label,
          page_number = EXCLUDED.page_number,
          display_page = EXCLUDED.display_page,
          created_at = EXCLUDED.created_at,
          updated_at = GREATEST(clock_timestamp(), readmax.bookmark.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at,
          deleted_at = EXCLUDED.deleted_at
      WHERE readmax.bookmark.user_id = EXCLUDED.user_id
        AND (EXCLUDED.mutation_at > COALESCE(readmax.bookmark.mutation_at, readmax.bookmark.updated_at)
          OR (EXCLUDED.mutation_at = COALESCE(readmax.bookmark.mutation_at, readmax.bookmark.updated_at)
              AND EXCLUDED.deleted_at IS NOT NULL AND readmax.bookmark.deleted_at IS NULL))
    RETURNING ${BOOKMARK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function softDeleteBookmark(
  userId: string,
  bookmarkId: string,
  deletedAt?: Date,
): Promise<boolean> {
  const pool = getPool();
  const mutationAt = (deletedAt ?? new Date()).toISOString();
  const result = await pool.query(sql`
    UPDATE readmax.bookmark
    SET deleted_at = ${mutationAt},
        updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond'),
        mutation_at = ${mutationAt}
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
      AND (${mutationAt}::timestamptz > COALESCE(mutation_at, updated_at)
        OR (${mutationAt}::timestamptz = COALESCE(mutation_at, updated_at) AND deleted_at IS NULL))
  `);
  if (deletedAt && !result.rowCount) {
    // Legacy deletes can lack the book ID needed to insert a tombstone. Keep
    // the mutation retryable until its target exists instead of losing it.
    const existing = await pool.query(sql`
      SELECT id FROM readmax.bookmark WHERE id = ${bookmarkId} AND user_id = ${userId}
    `);
    if (existing.rows.length === 0)
      throw new Error("Cannot persist bookmark deletion without its book ID");
  }
  return (result.rowCount ?? 0) > 0;
}

export async function getBookmarksByUser(
  userId: string,
  since?: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<BookmarkRow[]> {
  const pool = getPool();
  if (since) {
    const cursorTimestamp = exactCursorTimestamp ?? since.toISOString();
    const result = await pool.query<BookmarkRow>(sql`
      SELECT ${BOOKMARK_COLUMNS}, updated_at::text AS "cursorTimestamp"
      FROM readmax.bookmark
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

  const result = await pool.query<BookmarkRow>(sql`
    SELECT ${BOOKMARK_COLUMNS}
    FROM readmax.bookmark
    WHERE user_id = ${userId}
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}
