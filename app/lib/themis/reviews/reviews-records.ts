import {
  createCollection,
  getItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import { DEFAULT_REVIEW_PREFERENCES } from "~/lib/review/review-types";
import type { ReviewAttemptDTO, ReviewProgressResponse } from "~/lib/review/review-types";
import type { ReviewAttempt, ReviewCache } from "./reviews-types";

export function reviewAssignmentId(chapterKey: string, fingerprint: string): string {
  return JSON.stringify([chapterKey, fingerprint]);
}

export function emptyReviewCache(userId: string, bookId: string): ReviewCache {
  return {
    version: 1,
    userId,
    bookId,
    preferences: { ...DEFAULT_REVIEW_PREFERENCES },
    checkpoints: createCollection("key"),
    assignments: createCollection("id"),
    questions: createCollection("id"),
    attempts: createCollection("id"),
    drafts: createCollection("id"),
    submission: null,
    activeChapterKey: null,
    presentation: "reading",
  };
}

export function normalizeReviewAttempt({
  document,
  annotations,
  ...attempt
}: ReviewAttemptDTO): ReviewAttempt {
  return {
    ...attempt,
    documentJson: JSON.stringify(document),
    annotations: createCollection(
      "id",
      annotations.map((annotation, i) => ({ ...annotation, id: String(i) })),
    ),
  };
}

/** Wire latest/pass/updatedAt projections are intentionally discarded. */
export function mergeReviewProgress(
  cache: ReviewCache,
  response: ReviewProgressResponse,
): ReviewCache {
  let assignments = cache.assignments;
  let attempts = cache.attempts;
  for (const progress of response.progress) {
    if (progress.userId !== cache.userId || progress.bookId !== cache.bookId) continue;
    const { chapterKey, sourceFingerprint, questionId } = progress;
    assignments = upsertItem(assignments, {
      id: reviewAssignmentId(chapterKey, sourceFingerprint),
      chapterKey,
      sourceFingerprint,
      questionId,
    });
  }
  for (const attempt of response.attempts) {
    if (attempt.userId !== cache.userId || attempt.bookId !== cache.bookId) continue;
    if (!getItem(attempts, attempt.id))
      attempts = upsertItem(attempts, normalizeReviewAttempt(attempt));
  }
  return assignments === cache.assignments && attempts === cache.attempts
    ? cache
    : { ...cache, assignments, attempts };
}
