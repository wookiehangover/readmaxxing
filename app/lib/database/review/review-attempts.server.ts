import { sql } from "pg-sql";
import { isDeepStrictEqual } from "node:util";
import { getPool } from "../pool";
import { reviewGradeSchema, reviewSubmitRequestSchema } from "~/lib/review/review-schemas";
import type {
  ReviewAttemptDTO,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
} from "~/lib/review/review-types";
import type { z } from "zod";
import { reviewModelSchema } from "./review-records.server";
import type { ReviewModelProvenance } from "./review-records.server";
import { getOwnedReviewChapter } from "./review-source.server";
import { getReviewProgress } from "./review-progress.server";

const columns = sql`
  a.id, a.user_id AS "userId", a.book_id AS "bookId", a.chapter_key AS "chapterKey",
  a.source_fingerprint AS "sourceFingerprint", a.question_id AS "questionId",
  a.document, a.plain_text AS "plainText", a.grading, a.verdict, a.feedback, a.annotations,
  (extract(epoch FROM a.created_at) * 1000)::float8 AS "createdAt"
`;
export class ReviewAttemptConflictError extends Error {
  constructor() {
    super("Attempt id was already used with a different submission");
  }
}
export class ReviewSourceMismatchError extends Error {
  constructor() {
    super("Review source or assigned question is unavailable or has changed");
  }
}
export type ReviewGrade = z.infer<typeof reviewGradeSchema>;
export interface ReviewJudgment extends ReviewGrade {
  provenance: ReviewModelProvenance;
  gradingVersion: string;
}

/** Owner-scoped lookup for idempotent retries before calling the model. */
export async function getReviewAttempt(
  userId: string,
  id: string,
): Promise<ReviewAttemptDTO | null> {
  const result = await getPool().query<ReviewAttemptDTO>(sql`
    SELECT ${columns} FROM readmax.review_attempt a
    JOIN readmax.book b ON b.id = a.book_id AND b.user_id = a.user_id
    WHERE a.user_id = ${userId} AND a.id = ${id} AND b.deleted_at IS NULL
      AND COALESCE(b.format, 'epub') = 'epub'
  `);
  return result.rows[0] ?? null;
}
export async function listReviewAttempts(
  userId: string,
  bookId: string,
): Promise<ReviewAttemptDTO[]> {
  const result = await getPool().query<ReviewAttemptDTO>(sql`
    SELECT ${columns} FROM readmax.review_attempt a
    JOIN readmax.book b ON b.id = a.book_id AND b.user_id = a.user_id
    WHERE a.user_id = ${userId} AND a.book_id = ${bookId} AND b.deleted_at IS NULL
      AND COALESCE(b.format, 'epub') = 'epub'
    ORDER BY a.created_at, a.id
  `);
  return result.rows;
}
export function assertSameReviewSubmission(
  attempt: ReviewAttemptDTO,
  request: ReviewSubmitRequest,
): void {
  if (
    attempt.id !== request.id ||
    attempt.bookId !== request.bookId ||
    attempt.chapterKey !== request.chapterKey ||
    attempt.questionId !== request.questionId ||
    attempt.grading !== request.grading ||
    attempt.plainText !== request.plainText ||
    !isDeepStrictEqual(attempt.document, request.document)
  ) {
    throw new ReviewAttemptConflictError();
  }
}

/** Accept only a server-produced judgment. No client mutation can set progress/pass directly. */
export async function recordReviewAttempt(
  userId: string,
  request: ReviewSubmitRequest,
  judgment: ReviewJudgment,
): Promise<ReviewSubmitResponse> {
  const submission = reviewSubmitRequestSchema.parse(request);
  const grade = reviewGradeSchema.parse(judgment);
  const provenance = reviewModelSchema.parse(judgment.provenance);
  if (!judgment.gradingVersion.trim()) throw new Error("Missing grading version");
  for (const annotation of grade.annotations) {
    if (
      annotation.end <= annotation.start ||
      annotation.end > submission.plainText.length ||
      submission.plainText.slice(annotation.start, annotation.end) !== annotation.quote
    ) {
      throw new Error("Review annotation does not match the submitted snapshot");
    }
  }
  const source = await getOwnedReviewChapter(userId, submission.bookId, submission.chapterKey);
  if (!source) throw new ReviewSourceMismatchError();
  const progress = await getReviewProgress(
    userId,
    submission.bookId,
    submission.chapterKey,
    source.sourceFingerprint,
  );
  if (!progress || progress.questionId !== submission.questionId)
    throw new ReviewSourceMismatchError();
  // The FK binds the question, fingerprint and checkpoint. The unique (user,id)
  // makes repeated/concurrent requests append once; no existing result is overwritten.
  await getPool().query(sql`
    INSERT INTO readmax.review_attempt
      (user_id, id, book_id, chapter_key, source_fingerprint, question_id, document,
       plain_text, grading, verdict, feedback, annotations, provenance, grading_version)
    VALUES (${userId}, ${submission.id}, ${submission.bookId}, ${submission.chapterKey},
      ${source.sourceFingerprint}, ${submission.questionId}, ${JSON.stringify(submission.document)}::jsonb,
      ${submission.plainText}, ${submission.grading}, ${grade.verdict}, ${grade.feedback},
      ${JSON.stringify(grade.annotations)}::jsonb, ${JSON.stringify(provenance)}::jsonb, ${judgment.gradingVersion})
    ON CONFLICT (user_id, id) DO NOTHING
  `);
  const attempt = await getReviewAttempt(userId, submission.id);
  if (!attempt) throw new ReviewSourceMismatchError();
  assertSameReviewSubmission(attempt, submission);
  const current = await getReviewProgress(
    userId,
    submission.bookId,
    submission.chapterKey,
    source.sourceFingerprint,
  );
  if (!current) throw new ReviewSourceMismatchError();
  return { attempt, progress: current };
}
