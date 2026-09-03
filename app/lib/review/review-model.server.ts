import { gateway } from "@ai-sdk/gateway";
import { generateObject } from "ai";
import { z } from "zod";
import { reviewRubricSchema } from "~/lib/database/review/review-records.server";
import type { ReviewQuestionRecord } from "~/lib/database/review/review-records.server";
import type { GeneratedReviewQuestion } from "~/lib/database/review/review-questions.server";
import type { ReviewJudgment } from "~/lib/database/review/review-attempts.server";
import { ReviewApiFailure } from "./review-errors.server";
import { reviewGradeSchema } from "./review-schemas";
import type { ReviewDifficulty, ReviewGradingLevel } from "./review-types";
import { reviewGenerationInstructions, reviewGradingInstructions } from "./review-prompts.server";

export const REVIEW_MODEL = "openai/gpt-5.6-terra";
export const REVIEW_MODEL_TIMEOUT_MS = 45_000;
// Conservative UTF-8 budgets; reject oversized inputs rather than clipping a chapter/answer.
export const REVIEW_MAX_CHAPTER_BYTES = 80_000;
export const REVIEW_MAX_PROMPT_BYTES = 160_000;
const provenance = { model: REVIEW_MODEL, provider: "ai-gateway" };

const generatedSchema = z
  .object({
    question: z.string().trim().min(160).max(6_000),
    rubric: reviewRubricSchema.extend({
      criteria: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(80),
            description: z.string().trim().min(20).max(4_000),
          }),
        )
        .min(3)
        .max(6),
      passingGuidance: z.string().trim().min(20).max(8_000),
    }),
  })
  .strict();

const issueSchema = z.enum([
  "unclear_claim",
  "insufficient_evidence",
  "unexplained_reasoning",
  "incomplete_coverage",
  "inaccurate_reading",
  "unsupported_inference",
  "missing_counterargument",
  "limited_depth",
  "off_topic",
]);
const critique: Record<z.infer<typeof issueSchema>, string> = {
  unclear_claim: "Your central claim needs to be clearer.",
  insufficient_evidence: "Your answer needs more specific support from the chapter.",
  unexplained_reasoning: "Explain how your evidence supports your claim.",
  incomplete_coverage: "Your answer leaves part of the question unaddressed.",
  inaccurate_reading: "Recheck the accuracy of your reading against the chapter.",
  unsupported_inference: "Your conclusion goes beyond the evidence you have explained.",
  missing_counterargument:
    "Your answer needs to engage more fully with an alternative interpretation or objection.",
  limited_depth:
    "Develop your analysis beyond summary and explain the implications of your claims.",
  off_topic: "Your answer needs to address the question directly.",
};
const judgmentSchema = z
  .object({
    verdict: z.enum(["pass", "fail", "needs_work"]),
    issues: z.array(issueSchema).max(6),
    annotations: z
      .array(
        z
          .object({
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
            quote: z.string().min(1).max(2_000),
            issue: issueSchema,
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

function fullChapter(text: string): void {
  if (!text.trim() || Buffer.byteLength(text, "utf8") > REVIEW_MAX_CHAPTER_BYTES) {
    throw new ReviewApiFailure(
      "unsupported_source",
      "This full chapter is too large or empty for review. You can disable reviews to continue reading.",
    );
  }
}
function boundedPrompt(data: unknown, purpose: "generation" | "grading"): string {
  const prompt = JSON.stringify(data);
  if (Buffer.byteLength(prompt, "utf8") > REVIEW_MAX_PROMPT_BYTES) {
    throw new ReviewApiFailure(
      purpose === "grading" ? "invalid_request" : "unsupported_source",
      purpose === "grading"
        ? "This answer is too large to grade with the full chapter. Shorten the answer and submit it again."
        : "The full chapter exceeds the review size limit. You can disable reviews to continue reading.",
    );
  }
  return prompt;
}

export async function generateReviewQuestion(
  text: string,
  difficulty: ReviewDifficulty,
): Promise<GeneratedReviewQuestion> {
  fullChapter(text);
  const prompt = boundedPrompt({ chapterText: text }, "generation");
  try {
    const result = await generateObject({
      model: gateway(REVIEW_MODEL),
      schema: generatedSchema,
      schemaName: "chapter_review_question",
      maxOutputTokens: 6_000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(REVIEW_MODEL_TIMEOUT_MS),
      instructions: reviewGenerationInstructions(difficulty),
      prompt,
    });
    const generated = generatedSchema.parse(result.object);
    if (
      new Set(generated.rubric.criteria.map((item) => item.id)).size !==
      generated.rubric.criteria.length
    ) {
      throw new Error("Duplicate rubric criteria");
    }
    return { ...generated, difficulty, provenance };
  } catch {
    throw new ReviewApiFailure(
      "generation_failed",
      "The review question could not be generated. Retry or disable reviews to continue reading.",
    );
  }
}

export async function gradeReviewAnswer(options: {
  chapterText: string;
  question: ReviewQuestionRecord;
  plainText: string;
  grading: ReviewGradingLevel;
}): Promise<ReviewJudgment> {
  fullChapter(options.chapterText);
  const prompt = boundedPrompt(
    {
      chapterText: options.chapterText,
      question: options.question.question,
      rubric: options.question.rubric,
      submittedAnswer: options.plainText,
    },
    "grading",
  );
  try {
    const result = await generateObject({
      model: gateway(REVIEW_MODEL),
      schema: judgmentSchema,
      schemaName: "chapter_review_judgment",
      maxOutputTokens: 3_000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(REVIEW_MODEL_TIMEOUT_MS),
      instructions: reviewGradingInstructions(options.grading),
      prompt,
    });
    const judgment = judgmentSchema.parse(result.object);
    if (
      judgment.verdict === "pass"
        ? judgment.issues.length > 0 || judgment.annotations.length > 0
        : judgment.issues.length === 0
    ) {
      throw new Error("Inconsistent verdict");
    }
    const annotations = judgment.annotations.flatMap((annotation) => {
      if (!judgment.issues.includes(annotation.issue)) throw new Error("Invalid annotation issue");
      let { start, end } = annotation;
      if (
        end <= start ||
        end > options.plainText.length ||
        options.plainText.slice(start, end) !== annotation.quote
      ) {
        // Models can quote the answer correctly but miscount UTF-16 offsets. Repair only an
        // exact, unique quote; ambiguous/missing optional annotations must not discard a grade.
        start = options.plainText.indexOf(annotation.quote);
        if (start < 0 || options.plainText.indexOf(annotation.quote, start + 1) >= 0) return [];
        end = start + annotation.quote.length;
      }
      return [{ ...annotation, start, end }];
    });
    const grade = reviewGradeSchema.parse({
      verdict: judgment.verdict,
      feedback:
        judgment.verdict === "pass"
          ? "Your answer meets the review criteria at the selected grading level."
          : [...new Set(judgment.issues)].map((issue) => critique[issue]).join(" "),
      annotations: annotations.map(({ start, end, quote, issue }) => ({
        start,
        end,
        quote,
        feedback: critique[issue],
      })),
    });
    return { ...grade, provenance, gradingVersion: "chapter-review-grading-v1" };
  } catch {
    throw new ReviewApiFailure(
      "grading_failed",
      "Your answer could not be graded. Keep your answer and retry the same submission.",
    );
  }
}
