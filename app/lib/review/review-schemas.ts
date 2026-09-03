import { z } from "zod";
import { REVIEW_DIFFICULTIES, REVIEW_GRADING_LEVELS } from "./review-types";
import type { ReviewAnswerSnapshot, ReviewRichTextNode } from "./review-types";

const id = z.string().min(1).max(200);
export const reviewDifficultySchema = z.enum(REVIEW_DIFFICULTIES);
export const reviewGradingSchema = z.enum(REVIEW_GRADING_LEVELS);
export const reviewFingerprintSchema = z.string().regex(/^review-text-v1:[a-f0-9]{64}$/);
const point = z.object({
  spineIndex: z.number().int().nonnegative(),
  href: z.string().min(1),
  fragment: z.string().nullable(),
  textOffset: z.number().int().nonnegative(),
});
export const reviewBoundarySchema = z
  .object({
    key: id,
    title: z.string(),
    start: point,
    end: point.nullable(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.endOffset > value.startOffset &&
      value.key === `review-v1:${value.start.spineIndex}:${value.start.textOffset}`,
  );

const node: z.ZodType<ReviewRichTextNode> = z.lazy(() =>
  z.object({
    type: z.enum([
      "doc",
      "paragraph",
      "text",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "codeBlock",
      "hardBreak",
      "horizontalRule",
    ]),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.json()).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.string(), z.json()).optional() }))
      .optional(),
    content: z.array(node).optional(),
  }),
);

/** Stable plain-text/annotation convention shared by the editor and judge. */
export function reviewDocumentPlainText(document: ReviewRichTextNode): string {
  function inline(value: ReviewRichTextNode): string {
    if (value.type === "text") return value.text ?? "";
    if (value.type === "hardBreak") return "\n";
    return (value.content ?? []).map(inline).join("");
  }
  const blocks: string[] = [];
  function visit(value: ReviewRichTextNode) {
    if (["paragraph", "heading", "codeBlock"].includes(value.type)) blocks.push(inline(value));
    else for (const child of value.content ?? []) visit(child);
  }
  visit(document);
  return blocks.join("\n\n");
}
export function canSubmitReviewAnswer(plainText: string): boolean {
  // PostgreSQL length() uses Unicode code points too, rather than UTF-16 units.
  return Array.from(plainText.trim()).length > 30;
}
export const reviewQuestionRequestSchema = z
  .object({
    bookId: id,
    chapterKey: id,
    difficulty: reviewDifficultySchema,
  })
  .strict();
export const reviewSubmitRequestSchema = z
  .object({
    id,
    bookId: id,
    chapterKey: id,
    questionId: id,
    grading: reviewGradingSchema,
    document: node.refine((value) => value.type === "doc"),
    plainText: z.string().max(100_000).refine(canSubmitReviewAnswer),
  })
  .strict()
  .refine(
    (value: ReviewAnswerSnapshot) =>
      JSON.stringify(value.document).length <= 1_000_000 &&
      value.plainText === reviewDocumentPlainText(value.document),
    "Answer text must match the submitted document",
  );
export const reviewGradeSchema = z.object({
  verdict: z.enum(["pass", "fail", "needs_work"]),
  feedback: z.string().min(1).max(12_000),
  annotations: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        quote: z.string().min(1),
        feedback: z.string().min(1).max(4_000),
      }),
    )
    .max(30)
    .default([]),
});
