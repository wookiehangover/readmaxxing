import { get, set } from "idb-keyval";
import { z } from "zod";
import { getReviewsStore } from "~/lib/sync/stores";
import type { ReviewCache } from "~/lib/themis/reviews/reviews-types";
import {
  reviewBoundarySchema,
  reviewDifficultySchema,
  reviewFingerprintSchema,
  reviewGradingSchema,
  reviewSubmitRequestSchema,
} from "./review-schemas";

function collection<T extends z.ZodType, K extends string>(item: T, idField: K) {
  return z
    .object({
      idField: z.literal(idField),
      ids: z.array(z.string()),
      map: z.record(z.string(), item),
      refsCount: z.record(z.string(), z.number()),
    })
    .refine(
      (value) =>
        value.ids.length === Object.keys(value.map).length &&
        new Set(value.ids).size === value.ids.length &&
        value.ids.every(
          (id) => value.map[id] && (value.map[id] as Record<string, unknown>)[idField] === id,
        ),
    );
}
const documentJson = z
  .string()
  .max(1_000_000)
  .refine((value) => {
    try {
      return reviewSubmitRequestSchema.shape.document.safeParse(JSON.parse(value)).success;
    } catch {
      return false;
    }
  });
const assignment = z.object({
  id: z.string(),
  chapterKey: z.string(),
  sourceFingerprint: reviewFingerprintSchema,
  questionId: z.string(),
});
const annotation = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  quote: z.string(),
  feedback: z.string(),
});
const cacheSchema = z.object({
  version: z.literal(1),
  userId: z.string(),
  bookId: z.string(),
  preferences: z.object({
    enabled: z.boolean(),
    difficulty: reviewDifficultySchema,
    grading: reviewGradingSchema,
  }),
  checkpoints: collection(
    reviewBoundarySchema.safeExtend({
      chapterIndex: z.number(),
      sourceFingerprint: reviewFingerprintSchema.nullable(),
      returnLocator: z.string().nullable(),
    }),
    "key",
  ),
  assignments: collection(assignment, "id"),
  questions: collection(
    z.object({
      id: z.string(),
      sourceFingerprint: reviewFingerprintSchema,
      difficulty: reviewDifficultySchema,
      generationVersion: z.string(),
      question: z.string(),
      createdAt: z.number(),
    }),
    "id",
  ),
  attempts: collection(
    z.object({
      id: z.string(),
      userId: z.string(),
      bookId: z.string(),
      chapterKey: z.string(),
      sourceFingerprint: reviewFingerprintSchema,
      questionId: z.string(),
      grading: reviewGradingSchema,
      verdict: z.enum(["pass", "fail", "needs_work"]),
      feedback: z.string(),
      plainText: z.string(),
      documentJson,
      createdAt: z.number(),
      annotations: collection(annotation, "id"),
    }),
    "id",
  ),
  drafts: collection(
    z.object({ id: z.string(), documentJson, revision: z.number(), updatedAt: z.number() }),
    "id",
  ),
  submission: z
    .object({
      id: z.string(),
      draftId: z.string(),
      draftRevision: z.number(),
      grading: reviewGradingSchema,
    })
    .nullable(),
  activeChapterKey: z.string().nullable(),
  presentation: z.enum(["reading", "review"]),
});

function cacheKey(userId: string, bookId: string) {
  return JSON.stringify([userId, bookId]);
}

export async function loadReviewCache(userId: string, bookId: string): Promise<ReviewCache | null> {
  // Reopening a book may race the previous scope's final draft write.
  await writes.get(cacheKey(userId, bookId))?.catch(() => {});
  const raw = await get<unknown>(cacheKey(userId, bookId), getReviewsStore());
  if (raw === undefined) return null;
  const cache = cacheSchema.parse(raw);
  if (
    cache.userId !== userId ||
    cache.bookId !== bookId ||
    Object.values(cache.attempts.map).some(
      (attempt) => attempt.userId !== userId || attempt.bookId !== bookId,
    )
  ) {
    throw new Error("Review cache belongs to a different account or book");
  }
  return cache;
}

// Transport queues only, never a second owner of review data. Serialize writes so
// an older IDB transaction cannot overwrite a newer draft or persisted retry id.
const writes = new Map<string, Promise<void>>();
export function saveReviewCache(cache: ReviewCache): Promise<void> {
  const key = cacheKey(cache.userId, cache.bookId);
  const pending = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => set(key, cache, getReviewsStore()));
  writes.set(key, pending);
  void pending
    .finally(() => {
      if (writes.get(key) === pending) writes.delete(key);
    })
    .catch(() => {});
  return pending;
}
