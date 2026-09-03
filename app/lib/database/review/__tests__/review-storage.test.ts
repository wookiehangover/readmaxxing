// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmitRequest } from "~/lib/review/review-types";
import { fingerprintReviewChapter } from "~/lib/review/chapter-identity";

const query = vi.hoisted(() => vi.fn());
vi.mock("../../pool", () => ({ getPool: () => ({ query }) }));
import { getOwnedReviewChapter, toReviewChapterDTO } from "../review-source.server";
import { findReviewQuestion, saveReviewQuestion } from "../review-questions.server";
import {
  getReviewProgress,
  listReviewProgress,
  startReviewProgress,
} from "../review-progress.server";
import {
  getReviewAttempt,
  listReviewAttempts,
  recordReviewAttempt,
  ReviewAttemptConflictError,
  ReviewSourceMismatchError,
} from "../review-attempts.server";
import { toReviewQuestionDTO } from "../review-records.server";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const KEY = "review-v1:0:0";
const TEXT = "The narrator changes her mind after hearing a different account of the journey.";
const MODEL = { model: "test-model", provider: "test-provider" };
const generated = {
  question: "How does the narrator's changed perspective reshape the meaning of the journey?",
  rubric: {
    criteria: [{ id: "evidence", description: "Relates interpretation to chapter evidence." }],
    passingGuidance: "A defensible interpretation supported by the chapter.",
  },
  provenance: MODEL,
  difficulty: "friendly" as const,
};
const judgment = {
  verdict: "pass" as const,
  feedback: "The interpretation is well supported.",
  annotations: [],
  provenance: MODEL,
  gradingVersion: "review-grade-v1",
};
let db: PGlite;
let migration: string;

function chapters(text = TEXT) {
  return [
    {
      index: 5,
      title: "Local edition title",
      text,
      spineStart: 0,
      spineEnd: 1,
      reviewBoundaries: [
        {
          key: KEY,
          title: "Chapter",
          startOffset: 0,
          endOffset: text.length,
          start: { spineIndex: 0, href: "text/chapter.xhtml", fragment: null, textOffset: 0 },
          end: null,
        },
      ],
    },
  ];
}
async function seedBook(userId: string, bookId: string, text = TEXT, format = "epub") {
  await db.query("INSERT INTO readmax.book (id,user_id,format) VALUES ($1,$2,$3)", [
    bookId,
    userId,
    format,
  ]);
  await db.query("INSERT INTO readmax.book_chapters (user_id,book_id,chapters) VALUES ($1,$2,$3)", [
    userId,
    bookId,
    JSON.stringify(chapters(text)),
  ]);
}
function submission(questionId: string, bookId = "book-a", id = "attempt-1"): ReviewSubmitRequest {
  const plainText =
    "The narrator revises her understanding because the competing account exposes her assumptions.";
  return {
    id,
    bookId,
    chapterKey: KEY,
    questionId,
    grading: "reading_group",
    plainText,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: plainText }] }],
    },
  };
}
async function checkpoint(userId = U1, bookId = "book-a") {
  const question = await saveReviewQuestion(TEXT, generated);
  await startReviewProgress(userId, bookId, KEY, question.id);
  return question;
}

beforeAll(async () => {
  db = new PGlite();
  query.mockImplementation((value: SQLQuery) => db.query(value.text, value.values));
  const baseline = await readFile("database/readmax/core.sql", "utf8");
  migration = await readFile("database/migrations/020-chapter-reviews.sql", "utf8");
  await db.exec(baseline);
  await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec(
    "TRUNCATE readmax.review_question, readmax.book_chapters, readmax.book, readmax.user CASCADE",
  );
  await db.query("INSERT INTO readmax.user (id) VALUES ($1), ($2)", [U1, U2]);
  await seedBook(U1, "book-a");
  await seedBook(U2, "book-b", `  ${TEXT.replaceAll(" ", "\n\t")}  `);
});
afterAll(async () => {
  await db?.close();
});

describe("review storage with PostgreSQL constraints", () => {
  it("replays the additive migration and baseline without modifying existing books, chapters or questions", async () => {
    const question = await checkpoint();
    await db.exec(migration);
    await db.exec(await readFile("database/readmax/reviews.sql", "utf8"));
    expect((await db.query("SELECT id FROM readmax.book ORDER BY id")).rows).toEqual([
      { id: "book-a" },
      { id: "book-b" },
    ]);
    expect((await getOwnedReviewChapter(U1, "book-a", KEY))?.text).toBe(TEXT);
    expect((await findReviewQuestion(question.sourceFingerprint, "friendly"))?.id).toBe(
      question.id,
    );
  });

  it("reuses a single canonical question across users/books and concurrent writers", async () => {
    const a = await getOwnedReviewChapter(U1, "book-a", KEY);
    const b = await getOwnedReviewChapter(U2, "book-b", KEY);
    expect(a?.sourceFingerprint).toBe(b?.sourceFingerprint);
    expect(toReviewChapterDTO(a!)).not.toHaveProperty("text");
    const questions = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        saveReviewQuestion(i % 2 ? a!.text : b!.text, {
          ...generated,
          question: `${generated.question} ${i}`,
        }),
      ),
    );
    expect(new Set(questions.map((q) => q.id)).size).toBe(1);
    expect(new Set(questions.map((q) => q.question)).size).toBe(1);
    expect(
      (await db.query("SELECT count(*)::int AS count FROM readmax.review_question")).rows,
    ).toEqual([{ count: 1 }]);
    expect(await startReviewProgress(U1, "book-a", KEY, questions[0]!.id)).toMatchObject({
      questionId: questions[0]!.id,
      userId: U1,
    });
    expect(await startReviewProgress(U2, "book-b", KEY, questions[0]!.id)).toMatchObject({
      questionId: questions[0]!.id,
      userId: U2,
    });
  });

  it("isolates content, difficulty and generation version, and retains an active question", async () => {
    const first = await checkpoint();
    const hard = await saveReviewQuestion(TEXT, { ...generated, difficulty: "adversarial" });
    const changed = await saveReviewQuestion(`${TEXT} Another event.`, generated);
    expect(new Set([first.id, hard.id, changed.id]).size).toBe(3);
    expect(
      await findReviewQuestion(first.sourceFingerprint, "friendly", "future-version"),
    ).toBeNull();
    expect(await startReviewProgress(U1, "book-a", KEY, changed.id)).toBeNull();
    expect((await startReviewProgress(U1, "book-a", KEY, hard.id))?.questionId).toBe(first.id);
    await expect(
      db.query("UPDATE readmax.review_progress SET question_id = $1", [changed.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("enforces book ownership, live EPUB sources, and private result reads", async () => {
    const question = await checkpoint();
    await recordReviewAttempt(U1, submission(question.id), judgment);
    expect(await getOwnedReviewChapter(U2, "book-a", KEY)).toBeNull();
    expect(await startReviewProgress(U2, "book-a", KEY, question.id)).toBeNull();
    expect(await getReviewAttempt(U2, "attempt-1")).toBeNull();
    expect(await listReviewAttempts(U2, "book-a")).toEqual([]);
    expect(await listReviewProgress(U2, "book-a")).toEqual([]);
    await expect(recordReviewAttempt(U2, submission(question.id), judgment)).rejects.toBeInstanceOf(
      ReviewSourceMismatchError,
    );
    await seedBook(U1, "pdf-book", TEXT, "pdf");
    expect(await getOwnedReviewChapter(U1, "pdf-book", KEY)).toBeNull();
    await db.query("UPDATE readmax.book SET deleted_at = NOW() WHERE id = 'book-a'");
    expect(await getOwnedReviewChapter(U1, "book-a", KEY)).toBeNull();
    expect(await getReviewAttempt(U1, "attempt-1")).toBeNull();
    expect(await listReviewProgress(U1, "book-a")).toEqual([]);
  });

  it("makes duplicate attempts idempotent and rejects changed payloads under the same id", async () => {
    const question = await checkpoint();
    const request = submission(question.id);
    const results = await Promise.all([
      recordReviewAttempt(U1, request, judgment),
      recordReviewAttempt(U1, request, { ...judgment, verdict: "fail" }),
    ]);
    expect(results[0]!.attempt).toEqual(results[1]!.attempt);
    expect(await listReviewAttempts(U1, "book-a")).toHaveLength(1);
    await expect(
      recordReviewAttempt(U1, { ...request, grading: "elite_professor" }, judgment),
    ).rejects.toBeInstanceOf(ReviewAttemptConflictError);
    await seedBook(U1, "book-c");
    await checkpoint(U1, "book-c");
    await expect(
      recordReviewAttempt(U1, submission(question.id, "book-c"), judgment),
    ).rejects.toBeInstanceOf(ReviewAttemptConflictError);
    expect(await listReviewAttempts(U1, "book-c")).toEqual([]);
    await checkpoint(U2, "book-b");
    expect(
      (await recordReviewAttempt(U2, submission(question.id, "book-b"), judgment)).attempt.userId,
    ).toBe(U2);
  });

  it("preserves immutable snapshots, grading levels and a prior pass after further attempts", async () => {
    const question = await checkpoint();
    const request = submission(question.id);
    const annotations = [
      { start: 4, end: 12, quote: "narrator", feedback: "Ground this claim in a specific detail." },
    ];
    await recordReviewAttempt(U1, request, { ...judgment, verdict: "needs_work", annotations });
    await recordReviewAttempt(
      U1,
      { ...request, id: "attempt-2", grading: "community_college" },
      judgment,
    );
    const final = await recordReviewAttempt(
      U1,
      { ...request, id: "attempt-3", grading: "tyler_cowen" },
      { ...judgment, verdict: "fail" },
    );
    expect(final.progress).toMatchObject({
      latestAttemptId: "attempt-3",
      passedAttemptId: "attempt-2",
    });
    const first = await getReviewAttempt(U1, "attempt-1");
    expect(first).toMatchObject({
      document: request.document,
      plainText: request.plainText,
      annotations,
      grading: "reading_group",
      verdict: "needs_work",
    });
    expect(JSON.parse(JSON.stringify(final))).toEqual(final);
    expect(typeof final.attempt.createdAt).toBe("number");
    expect(toReviewQuestionDTO(question)).not.toHaveProperty("rubric");
    expect(toReviewQuestionDTO(question)).not.toHaveProperty("provenance");
  });

  it("rejects stale sources and never infers a pass for changed chapter content", async () => {
    const question = await checkpoint();
    await recordReviewAttempt(U1, submission(question.id), judgment);
    const newText = `${TEXT} The narrator later retracts the statement.`;
    await db.query("UPDATE readmax.book_chapters SET chapters = $1 WHERE book_id = 'book-a'", [
      JSON.stringify(chapters(newText)),
    ]);
    expect(
      await getReviewProgress(U1, "book-a", KEY, await fingerprintReviewChapter(newText)),
    ).toBeNull();
    await expect(
      recordReviewAttempt(U1, submission(question.id, "book-a", "stale-attempt"), judgment),
    ).rejects.toBeInstanceOf(ReviewSourceMismatchError);
    expect(await listReviewAttempts(U1, "book-a")).toHaveLength(1);
  });

  it("fails closed for old, malformed, missing and duplicate boundary metadata", async () => {
    for (const data of [
      [{ index: 0, text: TEXT }],
      [{ ...chapters()[0], reviewBoundaries: [] }],
      [...chapters(), ...chapters()],
      [
        {
          ...chapters()[0],
          reviewBoundaries: [{ ...chapters()[0]!.reviewBoundaries[0], endOffset: 99_999 }],
        },
      ],
    ]) {
      await db.query("UPDATE readmax.book_chapters SET chapters = $1 WHERE book_id = 'book-a'", [
        JSON.stringify(data),
      ]);
      expect(await getOwnedReviewChapter(U1, "book-a", KEY)).toBeNull();
    }
  });

  it("validates answer length, text consistency and annotation anchoring before persisting", async () => {
    const question = await checkpoint();
    const request = submission(question.id);
    await expect(
      recordReviewAttempt(U1, { ...request, plainText: "x".repeat(30) }, judgment),
    ).rejects.toThrow();
    await expect(
      recordReviewAttempt(U1, { ...request, plainText: `${request.plainText} spoofed` }, judgment),
    ).rejects.toThrow();
    await expect(
      recordReviewAttempt(U1, request, {
        ...judgment,
        annotations: [{ start: 0, end: 3, quote: "bad", feedback: "Wrong quote" }],
      }),
    ).rejects.toThrow("snapshot");
    expect(await listReviewAttempts(U1, "book-a")).toEqual([]);
  });
});
