import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface BookChaptersRow {
  userId: string;
  bookId: string;
  chapters: unknown;
  extractedAt: Date;
}

const CHAPTERS_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  chapters,
  extracted_at AS "extractedAt"
`;

export async function upsertBookChapters(
  userId: string,
  bookId: string,
  chapters: unknown,
  extractedAt: Date = new Date(),
): Promise<BookChaptersRow | null> {
  const pool = getPool();
  const result = await pool.query<BookChaptersRow>(sql`
    INSERT INTO readmax.book_chapters (user_id, book_id, chapters, extracted_at)
    VALUES (
      ${userId},
      ${bookId},
      ${JSON.stringify(chapters)}::jsonb,
      ${extractedAt.toISOString()}
    )
    ON CONFLICT (user_id, book_id) DO UPDATE
      SET chapters = EXCLUDED.chapters,
          extracted_at = EXCLUDED.extracted_at
    RETURNING ${CHAPTERS_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
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
