import { getBookByIdForUser } from "~/lib/database/book/book";
import { getBookChaptersForUser } from "~/lib/database/book/book-chapters";
import {
  getOwnedReviewChapter,
  toReviewChapterDTO,
} from "~/lib/database/review/review-source.server";
import type { OwnedReviewChapter } from "~/lib/database/review/review-source.server";
import {
  findReviewQuestion,
  getReviewQuestionById,
  saveReviewQuestion,
} from "~/lib/database/review/review-questions.server";
import { toReviewQuestionDTO } from "~/lib/database/review/review-records.server";
import {
  getReviewProgress,
  listReviewProgress,
  startReviewProgress,
} from "~/lib/database/review/review-progress.server";
import {
  assertSameReviewSubmission,
  getReviewAttempt,
  listReviewAttempts,
  recordReviewAttempt,
  ReviewSourceMismatchError,
} from "~/lib/database/review/review-attempts.server";
import type {
  ReviewQuestionRequest,
  ReviewQuestionResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
  ReviewProgressResponse,
} from "./review-types";
import { ReviewApiFailure } from "./review-errors.server";
import { generateReviewQuestion, gradeReviewAnswer } from "./review-model.server";

async function requireBook(userId: string, bookId: string): Promise<void> {
  const book = await getBookByIdForUser(bookId, userId);
  if (!book || book.deletedAt) throw new ReviewApiFailure("book_not_found", "Book not found.");
  if ((book.format ?? "epub") !== "epub")
    throw new ReviewApiFailure(
      "unsupported_source",
      "Chapter reviews are available for EPUB books only.",
    );
}

async function requireSource(
  userId: string,
  bookId: string,
  chapterKey: string,
): Promise<OwnedReviewChapter> {
  const source = await getOwnedReviewChapter(userId, bookId, chapterKey);
  if (source) return source;
  const stored = await getBookChaptersForUser(userId, bookId);
  const chapters = stored?.chapters;
  if (
    !Array.isArray(chapters) ||
    chapters.length === 0 ||
    chapters.some(
      (chapter) => !chapter || typeof chapter !== "object" || !("reviewBoundaries" in chapter),
    )
  ) {
    throw new ReviewApiFailure(
      "chapters_unavailable",
      "Upload the book chapters again to prepare chapter reviews.",
    );
  }
  throw new ReviewApiFailure(
    "unsupported_source",
    "The complete chapter boundary could not be resolved. You can disable reviews to continue reading.",
  );
}

async function recheckSource(userId: string, source: OwnedReviewChapter): Promise<void> {
  const current = await getOwnedReviewChapter(userId, source.bookId, source.chapterKey);
  if (!current || current.sourceFingerprint !== source.sourceFingerprint)
    throw new ReviewSourceMismatchError();
}

export async function reviewQuestion(
  userId: string,
  request: ReviewQuestionRequest,
): Promise<ReviewQuestionResponse> {
  await requireBook(userId, request.bookId);
  const source = await requireSource(userId, request.bookId, request.chapterKey);
  let progress = await getReviewProgress(
    userId,
    request.bookId,
    request.chapterKey,
    source.sourceFingerprint,
  );
  if (!progress) {
    let candidate = await findReviewQuestion(source.sourceFingerprint, request.difficulty);
    if (!candidate) {
      const generated = await generateReviewQuestion(source.text, request.difficulty);
      await recheckSource(userId, source);
      candidate = await saveReviewQuestion(source.text, generated);
    }
    progress = await startReviewProgress(userId, request.bookId, request.chapterKey, candidate.id);
  }
  if (!progress || progress.sourceFingerprint !== source.sourceFingerprint)
    throw new ReviewSourceMismatchError();
  // A concurrent request may have assigned a different difficulty. Always return its winner.
  const question = await getReviewQuestionById(progress.questionId);
  if (!question || question.sourceFingerprint !== source.sourceFingerprint)
    throw new ReviewSourceMismatchError();
  await recheckSource(userId, source);
  return { chapter: toReviewChapterDTO(source), question: toReviewQuestionDTO(question), progress };
}

export async function submitReview(
  userId: string,
  request: ReviewSubmitRequest,
): Promise<ReviewSubmitResponse> {
  await requireBook(userId, request.bookId);
  const source = await getOwnedReviewChapter(userId, request.bookId, request.chapterKey);
  if (!source) throw new ReviewSourceMismatchError();
  const existing = await getReviewAttempt(userId, request.id);
  if (existing) assertSameReviewSubmission(existing, request);
  const progress = await getReviewProgress(
    userId,
    request.bookId,
    request.chapterKey,
    source.sourceFingerprint,
  );
  if (!progress || progress.questionId !== request.questionId)
    throw new ReviewSourceMismatchError();
  if (existing) {
    if (existing.sourceFingerprint !== source.sourceFingerprint)
      throw new ReviewSourceMismatchError();
    await recheckSource(userId, source);
    return { attempt: existing, progress };
  }
  const question = await getReviewQuestionById(progress.questionId);
  if (!question || question.sourceFingerprint !== source.sourceFingerprint)
    throw new ReviewSourceMismatchError();
  const judgment = await gradeReviewAnswer({
    chapterText: source.text,
    question,
    plainText: request.plainText,
    grading: request.grading,
  });
  await recheckSource(userId, source);
  // The persistence layer rechecks assignment/source and arbitrates concurrent attempt IDs.
  const response = await recordReviewAttempt(userId, request, judgment);
  await recheckSource(userId, source);
  return response;
}

export async function reviewProgress(
  userId: string,
  bookId: string,
): Promise<ReviewProgressResponse> {
  await requireBook(userId, bookId);
  const [progress, attempts] = await Promise.all([
    listReviewProgress(userId, bookId),
    listReviewAttempts(userId, bookId),
  ]);
  const current = new Map<string, string>();
  // Historical attempts stay durable, but cannot restore a pass against replaced chapter text.
  for (const chapterKey of new Set(progress.map((item) => item.chapterKey))) {
    const source = await getOwnedReviewChapter(userId, bookId, chapterKey);
    if (source) current.set(chapterKey, source.sourceFingerprint);
  }
  await requireBook(userId, bookId);
  const visibleProgress = progress.filter(
    (item) => current.get(item.chapterKey) === item.sourceFingerprint,
  );
  return {
    progress: visibleProgress,
    attempts: attempts.filter((attempt) =>
      visibleProgress.some(
        (item) =>
          item.chapterKey === attempt.chapterKey &&
          item.sourceFingerprint === attempt.sourceFingerprint &&
          item.questionId === attempt.questionId,
      ),
    ),
  };
}
