import { randomUUID } from "node:crypto";
import { sql } from "pg-sql";
import { z } from "zod";
import { getPool } from "../pool";
import { fingerprintReviewChapter } from "~/lib/review/chapter-identity";
import { reviewDifficultySchema, reviewFingerprintSchema } from "~/lib/review/review-schemas";
import {
  REVIEW_GENERATION_VERSION,
  REVIEW_SCHEMA_VERSION,
  REVIEW_PROMPT_VERSION,
} from "~/lib/review/review-types";
import type { ReviewDifficulty } from "~/lib/review/review-types";
import { reviewRubricSchema, reviewModelSchema } from "./review-records.server";
import type { ReviewQuestionRecord } from "./review-records.server";

const columns = sql`id, source_fingerprint AS "sourceFingerprint", difficulty,
  generation_version AS "generationVersion", question, rubric,
  schema_version AS "schemaVersion", prompt_version AS "promptVersion", provenance,
  (extract(epoch FROM created_at) * 1000)::float8 AS "createdAt"`;

export async function findReviewQuestion(
  sourceFingerprint: string,
  difficulty: ReviewDifficulty,
  generationVersion = REVIEW_GENERATION_VERSION,
): Promise<ReviewQuestionRecord | null> {
  reviewFingerprintSchema.parse(sourceFingerprint);
  reviewDifficultySchema.parse(difficulty);
  const result = await getPool().query<ReviewQuestionRecord>(sql`
    SELECT ${columns} FROM readmax.review_question
    WHERE source_fingerprint = ${sourceFingerprint} AND difficulty = ${difficulty}
      AND generation_version = ${generationVersion}
  `);
  return result.rows[0] ?? null;
}
export async function getReviewQuestionById(id: string): Promise<ReviewQuestionRecord | null> {
  const result = await getPool().query<ReviewQuestionRecord>(sql`
    SELECT ${columns} FROM readmax.review_question WHERE id = ${id}
  `);
  return result.rows[0] ?? null;
}
const generatedSchema = z.object({
  question: z.string().min(1).max(16_000),
  rubric: reviewRubricSchema,
  provenance: reviewModelSchema,
  difficulty: reviewDifficultySchema,
});
export type GeneratedReviewQuestion = z.infer<typeof generatedSchema>;

/** First writer wins under the unique reuse key. Losers return the persisted winner. */
export async function saveReviewQuestion(
  chapterText: string,
  generated: GeneratedReviewQuestion,
): Promise<ReviewQuestionRecord> {
  const value = generatedSchema.parse(generated);
  const fingerprint = await fingerprintReviewChapter(chapterText);
  const result = await getPool().query<ReviewQuestionRecord>(sql`
    INSERT INTO readmax.review_question
      (id, source_fingerprint, difficulty, generation_version, schema_version, prompt_version, question, rubric, provenance)
    VALUES (${randomUUID()}, ${fingerprint}, ${value.difficulty}, ${REVIEW_GENERATION_VERSION},
      ${REVIEW_SCHEMA_VERSION}, ${REVIEW_PROMPT_VERSION}, ${value.question},
      ${JSON.stringify(value.rubric)}::jsonb, ${JSON.stringify(value.provenance)}::jsonb)
    ON CONFLICT (source_fingerprint, difficulty, generation_version) DO NOTHING
    RETURNING ${columns}
  `);
  const winner = result.rows[0] ?? (await findReviewQuestion(fingerprint, value.difficulty));
  if (!winner) throw new Error("Canonical review question unavailable");
  return winner;
}
