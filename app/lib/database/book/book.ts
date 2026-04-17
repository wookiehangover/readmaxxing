import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface BookRow {
  id: string;
  userId: string;
  title: string | null;
  author: string | null;
  format: string | null;
  coverBlobUrl: string | null;
  fileBlobUrl: string | null;
  fileHash: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UpsertBookData {
  id: string;
  title?: string | null;
  author?: string | null;
  format?: string | null;
  fileHash?: string | null;
  updatedAt?: Date;
}

const BOOK_COLUMNS = sql`
  id,
  user_id AS "userId",
  title,
  author,
  format,
  cover_blob_url AS "coverBlobUrl",
  file_blob_url AS "fileBlobUrl",
  file_hash AS "fileHash",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

export async function upsertBook(userId: string, book: UpsertBookData): Promise<BookRow | null> {
  const pool = getPool();
  const ts = book.updatedAt ? book.updatedAt.toISOString() : new Date().toISOString();
  const result = await pool.query<BookRow>(sql`
    INSERT INTO readmax.book (id, user_id, title, author, format, file_hash, updated_at)
    VALUES (${book.id}, ${userId}, ${book.title ?? null}, ${book.author ?? null}, ${book.format ?? null}, ${book.fileHash ?? null}, ${ts})
    ON CONFLICT (id) DO UPDATE
      SET title = COALESCE(EXCLUDED.title, readmax.book.title),
          author = COALESCE(EXCLUDED.author, readmax.book.author),
          format = COALESCE(EXCLUDED.format, readmax.book.format),
          file_hash = COALESCE(EXCLUDED.file_hash, readmax.book.file_hash),
          updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.updated_at > readmax.book.updated_at
    RETURNING ${BOOK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getBooksByUser(userId: string): Promise<BookRow[]> {
  const pool = getPool();
  const result = await pool.query<BookRow>(sql`
    SELECT ${BOOK_COLUMNS}
    FROM readmax.book
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `);
  return result.rows;
}

export async function getBooksByUserSince(userId: string, cursor: Date): Promise<BookRow[]> {
  const pool = getPool();
  const result = await pool.query<BookRow>(sql`
    SELECT ${BOOK_COLUMNS}
    FROM readmax.book
    WHERE user_id = ${userId}
      AND updated_at > ${cursor.toISOString()}
    ORDER BY updated_at ASC
  `);
  return result.rows;
}

/**
 * Get a single book by ID, scoped to a specific user for authorization.
 */
export async function getBookByIdForUser(bookId: string, userId: string): Promise<BookRow | null> {
  const pool = getPool();
  const result = await pool.query<BookRow>(sql`
    SELECT ${BOOK_COLUMNS}
    FROM readmax.book
    WHERE id = ${bookId}
      AND user_id = ${userId}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function softDeleteBook(userId: string, bookId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.book
    SET deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = ${bookId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Find the canonical (earliest-created, non-deleted) book for a given
 * user + file_hash. Used by the push handler to dedup cross-device uploads
 * of the same content. Ties on `created_at` (e.g. bulk backfill writes
 * with identical timestamps) are broken by `id ASC` for deterministic
 * canonical selection across replicas.
 */
export async function findBookByUserAndHash(
  userId: string,
  fileHash: string,
): Promise<BookRow | null> {
  const pool = getPool();
  const result = await pool.query<BookRow>(sql`
    SELECT ${BOOK_COLUMNS}
    FROM readmax.book
    WHERE user_id = ${userId}
      AND file_hash = ${fileHash}
      AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

/**
 * Insert or update a book row as a tombstone. Used when the push handler
 * detects a duplicate fileHash and needs to propagate the soft-delete of
 * the losing id to other devices via pull.
 *
 * If the row already exists non-deleted, it is soft-deleted in place. If
 * it exists already deleted, this is a no-op. Safe to run repeatedly.
 */
export async function insertTombstonedBook(
  userId: string,
  data: { id: string; fileHash?: string | null; createdAt?: Date },
): Promise<BookRow | null> {
  const pool = getPool();
  const nowIso = new Date().toISOString();
  const createdIso = (data.createdAt ?? new Date()).toISOString();
  const result = await pool.query<BookRow>(sql`
    INSERT INTO readmax.book (id, user_id, file_hash, created_at, updated_at, deleted_at)
    VALUES (${data.id}, ${userId}, ${data.fileHash ?? null}, ${createdIso}, ${nowIso}, ${nowIso})
    ON CONFLICT (id) DO UPDATE
      SET deleted_at = EXCLUDED.deleted_at,
          updated_at = EXCLUDED.updated_at
      WHERE readmax.book.deleted_at IS NULL
    RETURNING ${BOOK_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function updateBookBlobUrls(
  bookId: string,
  urls: { fileBlobUrl?: string; coverBlobUrl?: string },
): Promise<BookRow | null> {
  const pool = getPool();
  const result = await pool.query<BookRow>(sql`
    UPDATE readmax.book
    SET file_blob_url = COALESCE(${urls.fileBlobUrl ?? null}, file_blob_url),
        cover_blob_url = COALESCE(${urls.coverBlobUrl ?? null}, cover_blob_url),
        updated_at = NOW()
    WHERE id = ${bookId}
    RETURNING ${BOOK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
