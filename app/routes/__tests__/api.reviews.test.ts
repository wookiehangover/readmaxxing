// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReviewQuestionResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
} from "~/lib/review/review-types";

const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn(), generate: vi.fn() }));
vi.mock("~/lib/database/pool", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("@ai-sdk/gateway", () => ({ gateway: () => ({ id: "mock-model" }) }));
import { action as questionAction, loader as questionLoader } from "~/routes/api.reviews.question";
import { action as attemptAction } from "~/routes/api.reviews.attempts";
import { loader as progressLoader, action as progressAction } from "~/routes/api.reviews.progress";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const KEY = "review-v1:0:0";
const TEXT =
  "The narrator initially trusts the account. In the middle she questions its assumptions. At the end she revises her interpretation of the journey.";
const LATER = "LATER CHAPTER SPOILER: the narrator confesses.";
const generated = {
  question:
    "How does the narrator's changing account of the journey reshape your understanding of her reliability? Develop an interpretation using contrasting details from the beginning and end of this chapter, and explain why a different reading is less convincing.",
  rubric: {
    criteria: [
      { id: "claim", description: "Defends a coherent reading of the narrator's reliability." },
      {
        id: "evidence",
        description: "Connects contrasting details in the chapter to that reading.",
      },
      {
        id: "alternative",
        description: "Considers an alternative reading and explains its limits.",
      },
    ],
    passingGuidance:
      "Private rubric: supported reasoning and defensible alternatives are acceptable.",
  },
};
let db: PGlite;

function chapters(text = TEXT) {
  return [
    {
      index: 0,
      text: `${text}\n\n${LATER}`,
      reviewBoundaries: [
        {
          key: KEY,
          title: "A chapter",
          startOffset: 0,
          endOffset: text.length,
          start: { spineIndex: 0, href: "chapter.xhtml", fragment: null, textOffset: 0 },
          end: { spineIndex: 1, href: "later.xhtml", fragment: null, textOffset: 0 },
        },
      ],
    },
  ];
}
async function replaceChapters(value: unknown, bookId = "book-a") {
  await db.query("UPDATE readmax.book_chapters SET chapters = $1 WHERE book_id = $2", [
    JSON.stringify(value),
    bookId,
  ]);
}
function post(body: unknown, userId = U1) {
  return new Request("http://localhost/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: JSON.stringify(body),
  });
}
function questionRequest(bookId = "book-a", difficulty = "friendly", userId = U1) {
  return questionAction({ request: post({ bookId, chapterKey: KEY, difficulty }, userId) });
}
async function checkpoint() {
  const response = await questionRequest();
  expect(response.status).toBe(200);
  return (await response.json()) as ReviewQuestionResponse;
}
function submission(
  questionId: string,
  plainText = "The narrator changes her mind as competing evidence exposes her initial assumptions.",
): ReviewSubmitRequest {
  return {
    id: "attempt-1",
    bookId: "book-a",
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
function progressRequest(bookId = "book-a", userId = U1) {
  return progressLoader({
    request: new Request(`http://localhost/api/reviews/progress?bookId=${bookId}`, {
      headers: { "x-test-user": userId },
    }),
  });
}
async function count(table: "review_attempt" | "review_question") {
  return (await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM readmax.${table}`))
    .rows[0]!.count;
}

beforeAll(async () => {
  db = new PGlite();
  mocks.query.mockImplementation((value: SQLQuery) => db.query(value.text, value.values));
  await db.exec(await readFile("database/readmax/core.sql", "utf8"));
  await db.exec(
    await readFile("database/migrations/007-book-chapters-current-upload-id.sql", "utf8"),
  );
  await db.exec(await readFile("database/migrations/020-chapter-reviews.sql", "utf8"));
}, 30_000);
beforeEach(async () => {
  mocks.auth.mockReset().mockImplementation((request: Request) => ({
    userId: request.headers.get("x-test-user") ?? U1,
  }));
  mocks.generate.mockReset().mockImplementation(({ schemaName }) =>
    Promise.resolve({
      object:
        schemaName === "chapter_review_question"
          ? generated
          : { verdict: "pass", issues: [], annotations: [] },
    }),
  );
  await db.exec(
    "TRUNCATE readmax.review_question, readmax.book_chapters, readmax.book, readmax.user CASCADE",
  );
  await db.query("INSERT INTO readmax.user (id) VALUES ($1),($2)", [U1, U2]);
  await db.query(
    "INSERT INTO readmax.book (id,user_id,format) VALUES ('book-a',$1,'epub'),('book-b',$2,'epub'),('pdf',$1,'pdf')",
    [U1, U2],
  );
  await db.query(
    "INSERT INTO readmax.book_chapters (user_id,book_id,chapters) VALUES ($1,'book-a',$3),($2,'book-b',$3)",
    [U1, U2, JSON.stringify(chapters())],
  );
});
afterAll(async () => {
  await db?.close();
});

describe("authenticated chapter review endpoints with real storage", () => {
  it("requires authentication on all endpoints", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const response of await Promise.all([
      questionRequest(),
      attemptAction({ request: post({}) }),
      progressRequest(),
    ])) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthenticated" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("rejects unsupported HTTP methods", async () => {
    const response = await questionLoader({
      request: new Request("http://localhost/api/reviews/question"),
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect((await progressAction({ request: post({}) })).status).toBe(405);
  });

  it.each([
    {},
    { bookId: "book-a", chapterKey: KEY, difficulty: "impossible" },
    { bookId: "book-a", chapterKey: KEY, difficulty: "friendly", rubric: {} },
    { bookId: "book-a", chapterKey: KEY, difficulty: "friendly", text: TEXT },
  ])("rejects invalid and client-controlled question inputs (%#)", async (body) => {
    expect((await questionAction({ request: post(body) })).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("handles malformed JSON, oversized and deeply nested bodies before model calls", async () => {
    const malformed = new Request("http://localhost", { method: "POST", body: "{" });
    expect((await questionAction({ request: malformed })).status).toBe(400);
    expect(
      (await attemptAction({ request: post({ plainText: "x".repeat(4_000_001) }) })).status,
    ).toBe(400);
    let value: unknown = {};
    for (let i = 0; i < 100; i++) value = { content: [value] };
    expect((await attemptAction({ request: post(value) })).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("hides unowned/deleted books and rejects PDFs", async () => {
    for (const response of await Promise.all([
      questionRequest("book-a", "friendly", U2),
      progressRequest("book-a", U2),
    ]))
      expect(response.status).toBe(404);
    await db.query("UPDATE readmax.book SET deleted_at = NOW() WHERE id = 'book-a'");
    expect((await questionRequest()).status).toBe(404);
    const pdf = await questionRequest("pdf");
    expect(pdf.status).toBe(422);
    expect(await pdf.json()).toMatchObject({ code: "unsupported_source" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("distinguishes legacy uploads from unresolved boundaries", async () => {
    await replaceChapters([{ index: 0, text: TEXT }]);
    const legacy = await questionRequest();
    expect(legacy.status).toBe(409);
    expect(await legacy.json()).toMatchObject({ code: "chapters_unavailable" });
    await replaceChapters([{ index: 0, text: TEXT, reviewBoundaries: [] }]);
    const unresolved = await questionRequest();
    expect(unresolved.status).toBe(422);
    expect(await unresolved.json()).toMatchObject({ code: "unsupported_source" });
  });

  it("uses the whole selected chapter, excludes later chapters and hides the rubric", async () => {
    const result = await checkpoint();
    expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt)).toEqual({ chapterText: TEXT });
    expect(JSON.stringify(result)).not.toContain(LATER);
    expect(result.question).not.toHaveProperty("rubric");
    expect(result.question).not.toHaveProperty("provenance");
    expect(result.chapter).not.toHaveProperty("text");
    expect(result.progress.questionId).toBe(result.question.id);
  });

  it("reuses normalized chapter questions across users and preserves the assigned difficulty", async () => {
    const first = await checkpoint();
    await replaceChapters(chapters(`  ${TEXT.replaceAll(" ", "\n\t")}  `), "book-b");
    const other = (await (
      await questionRequest("book-b", "friendly", U2)
    ).json()) as ReviewQuestionResponse;
    const changedSetting = (await (
      await questionRequest("book-a", "adversarial")
    ).json()) as ReviewQuestionResponse;
    expect(other.question).toEqual(first.question);
    expect(other.progress.userId).toBe(U2);
    expect(changedSetting.question).toEqual(first.question);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(await count("review_question")).toBe(1);
  });

  it("returns the persisted assignment when concurrent difficulties generate competing candidates", async () => {
    let release!: () => void;
    const bothEntered = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    mocks.generate.mockImplementation(async () => {
      if (++entered === 2) release();
      await bothEntered;
      return { object: generated };
    });
    const responses = await Promise.all([
      questionRequest(),
      questionRequest("book-a", "adversarial"),
    ]);
    const results = (await Promise.all(
      responses.map((response) => response.json()),
    )) as ReviewQuestionResponse[];
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(results[0]!.question).toEqual(results[1]!.question);
    for (const result of results) expect(result.question.id).toBe(result.progress.questionId);
    expect(await count("review_question")).toBe(2);
  });

  it("recovers from generation errors without persisting a partial question", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("private provider error"));
    const failed = await questionRequest();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: "generation_failed" });
    expect(await count("review_question")).toBe(0);
    await checkpoint();
  });

  it("rejects chapter replacement/deletion during generation before assignment", async () => {
    mocks.generate.mockImplementationOnce(async () => {
      await replaceChapters(chapters(`${TEXT} Changed.`));
      return { object: generated };
    });
    const response = await questionRequest();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "source_changed" });
    expect(await count("review_question")).toBe(0);
  });

  it.each([" ".repeat(40), "x".repeat(30), `  ${"😀".repeat(30)}  `])(
    "enforces >30 trimmed Unicode characters (%#)",
    async (text) => {
      const response = await attemptAction({ request: post(submission("q", text)) });
      expect(response.status).toBe(400);
      expect(mocks.generate).not.toHaveBeenCalled();
    },
  );

  it("rejects mismatched text, supplied grades/rubrics and unassigned questions", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    for (const extra of [
      { plainText: `${request.plainText}!` },
      { verdict: "pass" },
      { rubric: generated.rubric },
      { grade: "pass" },
    ]) {
      expect((await attemptAction({ request: post({ ...request, ...extra }) })).status).toBe(400);
    }
    expect(
      (await attemptAction({ request: post({ ...request, questionId: "not-assigned" }) })).status,
    ).toBe(409);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(await count("review_attempt")).toBe(0);
  });

  it("persists a private snapshot and returns identical request IDs without regrading", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id, `  ${"😀".repeat(31)}  `);
    const firstResponse = await attemptAction({ request: post(request) });
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as ReviewSubmitResponse;
    const retry = await (await attemptAction({ request: post(request) })).json();
    expect(retry).toEqual(first);
    expect(first.attempt).toMatchObject({
      plainText: request.plainText,
      document: request.document,
      userId: U1,
      grading: "reading_group",
      verdict: "pass",
    });
    expect(first.progress.passedAttemptId).toBe(request.id);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    const gradingCall = mocks.generate.mock.calls[1]![0];
    expect(JSON.parse(gradingCall.prompt).rubric).toEqual(generated.rubric);
    expect((await attemptAction({ request: post(request, U2) })).status).toBe(404);
    expect(await (await progressRequest("book-b", U2)).json()).toEqual({
      progress: [],
      attempts: [],
    });
  });

  it("arbitrates concurrent retries and rejects changed content under a reused ID", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    const responses = await Promise.all([
      attemptAction({ request: post(request) }),
      attemptAction({ request: post(request) }),
    ]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(results[0]).toEqual(results[1]);
    expect(await count("review_attempt")).toBe(1);
    const conflict = await attemptAction({
      request: post({ ...request, grading: "elite_professor" }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "attempt_conflict" });
  });

  it("keeps the submitted answer retryable after grading failure and never creates a false pass", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    mocks.generate.mockResolvedValueOnce({
      object: { verdict: "pass", issues: ["off_topic"], annotations: [] },
    });
    const failed = await attemptAction({ request: post(request) });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: "grading_failed" });
    expect(await count("review_attempt")).toBe(0);
    expect((await (await progressRequest()).json()).progress[0].passedAttemptId).toBeNull();
    expect((await attemptAction({ request: post(request) })).status).toBe(200);
  });

  it("records nonpass critiques, then a passing resubmission without replacing the first answer", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    mocks.generate.mockResolvedValueOnce({
      object: { verdict: "needs_work", issues: ["insufficient_evidence"], annotations: [] },
    });
    const first = (await (
      await attemptAction({ request: post(request) })
    ).json()) as ReviewSubmitResponse;
    expect(first.progress.passedAttemptId).toBeNull();
    expect(first.attempt.feedback).toBe(
      "Your answer needs more specific support from the chapter.",
    );
    const second = (await (
      await attemptAction({
        request: post({ ...request, id: "attempt-2", grading: "community_college" }),
      })
    ).json()) as ReviewSubmitResponse;
    expect(second.progress.passedAttemptId).toBe("attempt-2");
    expect(await count("review_attempt")).toBe(2);
  });

  it("rechecks source and ownership after grading before persistence", async () => {
    const { question } = await checkpoint();
    mocks.generate.mockImplementationOnce(async () => {
      await db.query("UPDATE readmax.book SET deleted_at = NOW() WHERE id = 'book-a'");
      return { object: { verdict: "pass", issues: [], annotations: [] } };
    });
    const response = await attemptAction({ request: post(submission(question.id)) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "source_changed" });
    expect(await count("review_attempt")).toBe(0);
  });

  it("does not expose stale cached attempts or hydrate their pass after source replacement", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    await attemptAction({ request: post(request) });
    await replaceChapters(chapters(`${TEXT} Changed.`));
    const retry = await attemptAction({ request: post(request) });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: "source_changed" });
    const response = await progressRequest();
    expect(await response.json()).toEqual({ progress: [], attempts: [] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await count("review_attempt")).toBe(1);
  });

  it("rechecks the source even when an identical cached attempt was just read", async () => {
    const { question } = await checkpoint();
    const request = submission(question.id);
    await attemptAction({ request: post(request) });
    let replaced = false;
    mocks.query.mockImplementation(async (value: SQLQuery) => {
      const result = await db.query(value.text, value.values);
      if (!replaced && value.text.includes("JOIN readmax.book b ON b.id = a.book_id")) {
        replaced = true;
        await replaceChapters(chapters(`${TEXT} Replaced during retry.`));
      }
      return result;
    });
    try {
      const response = await attemptAction({ request: post(request) });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "source_changed" });
      expect(mocks.generate).toHaveBeenCalledTimes(2);
      expect(await count("review_attempt")).toBe(1);
    } finally {
      mocks.query.mockImplementation((value: SQLQuery) => db.query(value.text, value.values));
    }
  });

  it.each(["", "?bookId=", "?bookId=book-a&bookId=book-b", "?bookId=book-a&userId=someone"])(
    "rejects invalid progress queries %s",
    async (query) => {
      expect(
        (
          await progressLoader({
            request: new Request(`http://localhost/api/reviews/progress${query}`),
          })
        ).status,
      ).toBe(400);
    },
  );

  it("returns an explicit recoverable unavailable response without leaking internal errors", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("database password secret"));
    const response = await questionRequest();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "unavailable",
      error: "Chapter reviews are temporarily unavailable. Keep your answer and retry.",
    });
  });
});
