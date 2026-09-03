import { sql } from "pg-sql";
import { getPool } from "../pool";
import type { ReviewProgressDTO } from "~/lib/review/review-types";
import { getOwnedReviewChapter } from "./review-source.server";
import { getReviewQuestionById } from "./review-questions.server";

// Passing/latest are projections of immutable attempts, not independently writable grades.
const progressColumns = sql`
  p.user_id AS "userId", p.book_id AS "bookId", p.chapter_key AS "chapterKey",
  p.source_fingerprint AS "sourceFingerprint", p.question_id AS "questionId",
  (SELECT a.id FROM readmax.review_attempt a WHERE a.user_id = p.user_id
    AND a.book_id = p.book_id AND a.chapter_key = p.chapter_key
    AND a.source_fingerprint = p.source_fingerprint
    ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS "latestAttemptId",
  (SELECT a.id FROM readmax.review_attempt a WHERE a.user_id = p.user_id
    AND a.book_id = p.book_id AND a.chapter_key = p.chapter_key
    AND a.source_fingerprint = p.source_fingerprint AND a.verdict = 'pass'
    ORDER BY a.created_at, a.id LIMIT 1) AS "passedAttemptId",
  (extract(epoch FROM GREATEST(p.created_at,
    (SELECT MAX(a.created_at) FROM readmax.review_attempt a WHERE a.user_id = p.user_id
      AND a.book_id = p.book_id AND a.chapter_key = p.chapter_key
      AND a.source_fingerprint = p.source_fingerprint))) * 1000)::float8 AS "updatedAt"
`;

export async function listReviewProgress(
  userId: string,
  bookId: string,
): Promise<ReviewProgressDTO[]> {
  const result = await getPool().query<ReviewProgressDTO>(sql`
    SELECT ${progressColumns} FROM readmax.review_progress p
    JOIN readmax.book b ON b.id = p.book_id AND b.user_id = p.user_id
    WHERE p.user_id = ${userId} AND p.book_id = ${bookId} AND b.deleted_at IS NULL
      AND COALESCE(b.format, 'epub') = 'epub'
    ORDER BY p.created_at, p.chapter_key
  `);
  return result.rows;
}

export async function getReviewProgress(
  userId: string,
  bookId: string,
  chapterKey: string,
  sourceFingerprint: string,
): Promise<ReviewProgressDTO | null> {
  const rows = await listReviewProgress(userId, bookId);
  return (
    rows.find(
      (row) => row.chapterKey === chapterKey && row.sourceFingerprint === sourceFingerprint,
    ) ?? null
  );
}

/** A checkpoint keeps its first assigned question, even if a later request changes difficulty. */
export async function startReviewProgress(
  userId: string,
  bookId: string,
  chapterKey: string,
  questionId: string,
): Promise<ReviewProgressDTO | null> {
  const source = await getOwnedReviewChapter(userId, bookId, chapterKey);
  if (!source) return null;
  const question = await getReviewQuestionById(questionId);
  if (!question || question.sourceFingerprint !== source.sourceFingerprint) return null;
  await getPool().query(sql`
    INSERT INTO readmax.review_progress (user_id, book_id, chapter_key, source_fingerprint, question_id)
    SELECT ${userId}::uuid, ${bookId}, ${chapterKey}, ${source.sourceFingerprint}, ${questionId}
    FROM readmax.book WHERE id = ${bookId} AND user_id = ${userId} AND deleted_at IS NULL
      AND COALESCE(format, 'epub') = 'epub'
    ON CONFLICT (user_id, book_id, chapter_key, source_fingerprint) DO NOTHING
  `);
  return getReviewProgress(userId, bookId, chapterKey, source.sourceFingerprint);
}
