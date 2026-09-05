// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fingerprintReviewChapter, normalizeReviewChapterText } from "../chapter-identity";
import { DEFAULT_REVIEW_PREFERENCES } from "../review-types";
import {
  canSubmitReviewAnswer,
  reviewDocumentPlainText,
  reviewQuestionRequestSchema,
  reviewSubmitRequestSchema,
} from "../review-schemas";

describe("review contracts without browser globals", () => {
  it("normalizes Unicode composition and packaging whitespace, retaining meaningful differences", async () => {
    expect(normalizeReviewChapterText(" \nCafe\u0301\u00a0 tells\t a tale. \n")).toBe(
      "Café tells a tale.",
    );
    expect(await fingerprintReviewChapter("Café tells a tale.")).toBe(
      await fingerprintReviewChapter(" \nCafe\u0301\u00a0tells\n\na tale. "),
    );
    const fingerprints = await Promise.all(
      ["We can go.", "We can't go.", "we can go.", "We can go!", "We can gó."].map(
        fingerprintReviewChapter,
      ),
    );
    expect(new Set(fingerprints).size).toBe(5);
    await expect(fingerprintReviewChapter(" \n\t")).rejects.toThrow("empty");
  });
  it("hashes the entire chapter rather than a truncated preview", async () => {
    const prefix = "The same opening. ".repeat(5000);
    expect(await fingerprintReviewChapter(`${prefix}A`)).not.toBe(
      await fingerprintReviewChapter(`${prefix}B`),
    );
  });
  it("has the approved serializable defaults", () => {
    expect(DEFAULT_REVIEW_PREFERENCES).toEqual({
      enabled: false,
      difficulty: "friendly",
      grading: "reading_group",
    });
    expect(typeof window).toBe("undefined");
  });
  it("defines stable block/line breaks and the strictly greater than 30 trimmed character threshold", () => {
    const document = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "One" },
            { type: "hardBreak" },
            { type: "text", text: "two" },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }],
            },
          ],
        },
      ],
    };
    expect(reviewDocumentPlainText(document)).toBe("One\ntwo\n\nThree");
    expect(canSubmitReviewAnswer(`  ${"x".repeat(30)} \n`)).toBe(false);
    expect(canSubmitReviewAnswer(`  ${"x".repeat(31)} \n`)).toBe(true);
    expect(canSubmitReviewAnswer("😀".repeat(16))).toBe(false);
    expect(canSubmitReviewAnswer("😀".repeat(31))).toBe(true);
  });
  it("does not accept supplied rubrics/verdicts or plain text disconnected from the rich-text snapshot", () => {
    expect(
      reviewQuestionRequestSchema.safeParse({
        bookId: "b",
        chapterKey: "c",
        difficulty: "friendly",
        rubric: {},
      }).success,
    ).toBe(false);
    const plainText = "x".repeat(31);
    const request = {
      id: "a",
      bookId: "b",
      chapterKey: "c",
      questionId: "q",
      grading: "reading_group",
      plainText,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: plainText }] }],
      },
    };
    expect(reviewSubmitRequestSchema.safeParse(request).success).toBe(true);
    expect(reviewSubmitRequestSchema.safeParse({ ...request, verdict: "pass" }).success).toBe(
      false,
    );
    expect(
      reviewSubmitRequestSchema.safeParse({ ...request, plainText: `${plainText}!` }).success,
    ).toBe(false);
  });
});
