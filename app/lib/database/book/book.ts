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
  const result = await pool.query<BookRow>(sql`
    INSERT INTO readmax.book (id, user_id, title, author, format, file_hash)
    VALUES (${book.id}, ${userId}, ${book.title ?? null}, ${book.author ?? null}, ${book.format ?? null}, ${book.fileHash ?? null})
    ON CONFLICT (id) DO UPDATE
      SET title = COALESCE(EXCLUDED.title, readmax.book.title),
          author = COALESCE(EXCLUDED.author, readmax.book.author),
          format = COALESCE(EXCLUDED.format, readmax.book.format),
          file_hash = COALESCE(EXCLUDED.file_hash, readmax.book.file_hash),
          updated_at = NOW()
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
