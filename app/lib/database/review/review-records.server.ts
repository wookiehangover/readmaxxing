import type { ReviewQuestionDTO } from "~/lib/review/review-types";
import { z } from "zod";

export const reviewRubricSchema = z.object({
  criteria: z
    .array(z.object({ id: z.string().min(1), description: z.string().min(1).max(4_000) }))
    .min(1)
    .max(20),
  passingGuidance: z.string().min(1).max(8_000),
});
export type ReviewRubric = z.infer<typeof reviewRubricSchema>;
export const reviewModelSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
});
export type ReviewModelProvenance = z.infer<typeof reviewModelSchema>;
/** Private server record. Never return this object directly from an endpoint. */
export interface ReviewQuestionRecord extends ReviewQuestionDTO {
  rubric: ReviewRubric;
  schemaVersion: number;
  promptVersion: number;
  provenance: ReviewModelProvenance;
}
export function toReviewQuestionDTO(record: ReviewQuestionRecord): ReviewQuestionDTO {
  return {
    id: record.id,
    sourceFingerprint: record.sourceFingerprint,
    difficulty: record.difficulty,
    generationVersion: record.generationVersion,
    question: record.question,
    createdAt: record.createdAt,
  };
}
