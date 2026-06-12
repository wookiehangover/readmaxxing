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
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

export async function upsertBookmark(
  userId: string,
  bookmark: UpsertBookmarkData,
): Promise<BookmarkRow | null> {
  const pool = getPool();
  const updatedAtIso = clampUpdatedAt(bookmark.updatedAt ?? bookmark.createdAt);
  // Clamp created_at/deleted_at too: a far-future deleted_at would match
  // `deleted_at > cursor` on every subsequent pull.
  const createdAtIso = clampUpdatedAt(bookmark.createdAt);
  const deletedAtIso = clampNullableTimestamp(bookmark.deletedAt);
  const result = await pool.query<BookmarkRow>(sql`
    INSERT INTO readmax.bookmark (id, user_id, book_id, cfi, label, page_number, display_page, created_at, updated_at, deleted_at)
    VALUES (
      ${bookmark.id},
      ${userId},
      ${bookmark.bookId},
      ${bookmark.cfi ?? null},
      ${bookmark.label ?? null},
      ${bookmark.pageNumber ?? null},
      ${bookmark.displayPage ?? null},
      ${createdAtIso},
      ${updatedAtIso},
      ${deletedAtIso}
    )
    ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          book_id = EXCLUDED.book_id,
          cfi = EXCLUDED.cfi,
          label = EXCLUDED.label,
          page_number = EXCLUDED.page_number,
          display_page = EXCLUDED.display_page,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
      WHERE EXCLUDED.updated_at > readmax.bookmark.updated_at
    RETURNING ${BOOKMARK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function softDeleteBookmark(userId: string, bookmarkId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.bookmark
    SET deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = ${bookmarkId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function getBookmarksByUser(userId: string, since?: Date): Promise<BookmarkRow[]> {
  const pool = getPool();
  if (since) {
    const result = await pool.query<BookmarkRow>(sql`
      SELECT ${BOOKMARK_COLUMNS}
      FROM readmax.bookmark
      WHERE user_id = ${userId}
        AND (updated_at > ${since.toISOString()} OR deleted_at > ${since.toISOString()})
      ORDER BY updated_at ASC
    `);
    return result.rows;
  }

  const result = await pool.query<BookmarkRow>(sql`
    SELECT ${BOOKMARK_COLUMNS}
    FROM readmax.bookmark
    WHERE user_id = ${userId}
    ORDER BY updated_at ASC
  `);
  return result.rows;
}
