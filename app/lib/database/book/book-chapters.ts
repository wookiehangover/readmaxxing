import type { PoolClient } from "pg";
import { Data } from "effect";
import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface BookChaptersRow {
  userId: string;
  bookId: string;
  chapters: unknown;
  /**
   * Time of the last successful upload/persist of this chapters set.
   * This is not guaranteed to be the original EPUB parse timestamp.
   */
  extractedAt: Date;
  currentUploadId: string | null;
}

export class ChapterUploadSessionMismatchError extends Data.TaggedError(
  "ChapterUploadSessionMismatchError",
)<{
  readonly userId: string;
  readonly bookId: string;
  readonly expectedUploadId: string;
  readonly actualUploadId: string | null;
}> {}

const CHAPTERS_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  chapters,
  extracted_at AS "extractedAt",
  current_upload_id AS "currentUploadId"
`;

function upsertBookChaptersQuery(
  userId: string,
  bookId: string,
  chapters: unknown,
  uploadId: string | null,
  extractedAt: Date,
) {
  return sql`
    INSERT INTO readmax.book_chapters (user_id, book_id, chapters, extracted_at, current_upload_id)
    VALUES (
      ${userId},
      ${bookId},
      ${JSON.stringify(chapters)}::jsonb,
      ${extractedAt.toISOString()},
      ${uploadId}
    )
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET chapters = EXCLUDED.chapters,
          extracted_at = EXCLUDED.extracted_at,
          current_upload_id = EXCLUDED.current_upload_id
    RETURNING ${CHAPTERS_COLUMNS}
  `;
}

async function lockBookChaptersUpload(client: PoolClient, userId: string, bookId: string) {
  await client.query(sql`
    SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${bookId}))
  `);
}

export interface ChapterWithIndex {
  readonly index: number;
}

function hasChapterIndex(value: unknown): value is ChapterWithIndex {
  const index = (value as { index?: unknown } | null)?.index;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0
  );
}

export function mergeChaptersByIndex(
  existingChapters: unknown,
  incomingChapters: readonly ChapterWithIndex[],
): unknown[] {
  const merged = new Map<number, unknown>();

  if (Array.isArray(existingChapters)) {
    for (const chapter of existingChapters) {
      if (hasChapterIndex(chapter)) {
        merged.set(chapter.index, chapter);
      }
    }
  }

  for (const chapter of incomingChapters) {
    merged.set(chapter.index, chapter);
  }

  return [...merged.entries()].sort(([a], [b]) => a - b).map(([, chapter]) => chapter);
}

export function isChapterUploadSessionMismatchError(
  err: unknown,
): err is ChapterUploadSessionMismatchError {
  return (
    err instanceof ChapterUploadSessionMismatchError ||
    (err as { _tag?: unknown } | null)?._tag === "ChapterUploadSessionMismatchError"
  );
}

/**
 * Legacy single-shot chapter upload. `extractedAt` is the last successful upload
 * time for the persisted set, not necessarily the EPUB's original parse time.
 */
export async function upsertBookChapters(
  userId: string,
  bookId: string,
  chapters: unknown,
  extractedAt: Date = new Date(),
): Promise<BookChaptersRow | null> {
  const pool = getPool();
  const result = await pool.query<BookChaptersRow>(
    upsertBookChaptersQuery(userId, bookId, chapters, null, extractedAt),
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function replaceBookChaptersWithLock(
  userId: string,
  bookId: string,
  uploadId: string | null,
  chapters: unknown,
  extractedAt: Date = new Date(),
): Promise<BookChaptersRow | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await lockBookChaptersUpload(client, userId, bookId);
    const row = await writeBookChapters(client, userId, bookId, uploadId, chapters, extractedAt);
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(console.error);
    throw err;
  } finally {
    client.release();
  }
}

async function writeBookChapters(
  client: PoolClient,
  userId: string,
  bookId: string,
  uploadId: string | null,
  chapters: unknown,
  extractedAt: Date,
): Promise<BookChaptersRow | null> {
  const result = await client.query<BookChaptersRow>(
    upsertBookChaptersQuery(userId, bookId, chapters, uploadId, extractedAt),
  );

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

async function mergeBookChaptersInTransaction(
  client: PoolClient,
  userId: string,
  bookId: string,
  uploadId: string,
  chapters: readonly ChapterWithIndex[],
  extractedAt: Date,
): Promise<BookChaptersRow | null> {
  await lockBookChaptersUpload(client, userId, bookId);

  const existing = await client.query<BookChaptersRow>(sql`
    SELECT ${CHAPTERS_COLUMNS}
    FROM readmax.book_chapters
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
    FOR UPDATE
  `);
  const existingRow = existing.rows[0];
  const actualUploadId = existingRow?.currentUploadId ?? null;

  if (!existingRow || actualUploadId !== uploadId) {
    throw new ChapterUploadSessionMismatchError({
      userId,
      bookId,
      expectedUploadId: uploadId,
      actualUploadId,
    });
  }

  const mergedChapters = mergeChaptersByIndex(existingRow.chapters, chapters);

  return writeBookChapters(client, userId, bookId, uploadId, mergedChapters, extractedAt);
}

export async function mergeBookChapters(
  userId: string,
  bookId: string,
  uploadId: string,
  chapters: readonly ChapterWithIndex[],
  extractedAt: Date = new Date(),
): Promise<BookChaptersRow | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const row = await mergeBookChaptersInTransaction(
      client,
      userId,
      bookId,
      uploadId,
      chapters,
      extractedAt,
    );
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK").catch(console.error);
    throw err;
  } finally {
    client.release();
  }
}

export async function getBookChaptersForUser(
  userId: string,
  bookId: string,
): Promise<BookChaptersRow | null> {
  const pool = getPool();
  const result = await pool.query<BookChaptersRow>(sql`
    SELECT ${CHAPTERS_COLUMNS}
    FROM readmax.book_chapters
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
  `);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
