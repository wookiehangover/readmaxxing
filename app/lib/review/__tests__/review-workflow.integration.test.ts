// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmitRequest } from "~/lib/review/review-types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  generate: vi.fn(),
  reupload: vi.fn(),
}));
vi.mock("~/lib/database/pool", () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("@ai-sdk/gateway", () => ({ gateway: () => ({ id: "mock-model" }) }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ reuploadBookChapters: mocks.reupload }));
import { action as questionAction } from "~/routes/api.reviews.question";
import { action as attemptAction } from "~/routes/api.reviews.attempts";
import { loader as progressLoader } from "~/routes/api.reviews.progress";

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

import { clear } from "idb-keyval";
import { getReviewsStore } from "~/lib/sync/stores";
import { loadReviewCache } from "~/lib/review/review-cache";
import { reviewClient } from "~/lib/review/review-client";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { createReviewsSaga } from "~/lib/themis/reviews/sagas/reviews-saga";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import {
  openReviewBook,
  setReviewsEnabled,
  setReviewGrading,
  startReviewCheckpoint,
  editReviewDraft,
  submitReviewAnswer,
  refreshReviewProgress,
  retryReviewQuestion,
} from "~/lib/themis/reviews/reviews-slice";

const stores: AppStore[] = [];
const responses: { url: string; status: number; data: unknown }[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await clear(getReviewsStore());
  responses.length = 0;
  mocks.reupload.mockReset();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const req = new Request(new URL(url, "http://localhost"), init);
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const path = new URL(req.url).pathname;
    const result = await (path.endsWith("/question")
      ? questionAction({ request: req })
      : path.endsWith("/attempts")
        ? attemptAction({ request: req })
        : progressLoader({ request: req }));
    responses.push({ url, status: result.status, data: await result.clone().json() });
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  });
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose();
  await loadReviewCache(U1, "book-a").catch(() => null);
  vi.unstubAllGlobals();
});
async function open() {
  const store = createAppStore();
  store.init();
  stores.push(store);
  store.runSaga(createReviewsSaga(store));
  store.dispatch(authSessionResolved({ id: U1, displayName: null }));
  store.dispatch(openReviewBook("book-a"));
  await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("ready"));
  return store;
}
async function begin(store: AppStore) {
  store.dispatch(setReviewsEnabled("book-a", true));
  store.dispatch(
    startReviewCheckpoint("book-a", 0, chapters()[0].reviewBoundaries[0], "return-cfi"),
  );
  await vi.waitFor(() =>
    expect(
      store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-a"),
    ).not.toBeNull(),
  );
  await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
}
function edit(
  store: AppStore,
  text = "The narrator changes her mind as competing evidence exposes her initial assumptions.",
) {
  const assignment = store.reviewsSelectors.selectReviewAssignment.select(store.state, "book-a")!;
  store.dispatch(
    editReviewDraft(
      "book-a",
      assignment.id,
      submission(assignment.questionId, text).document,
      Date.now(),
    ),
  );
}
async function pass(store: AppStore) {
  edit(store);
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
  );
}
describe("review workflow with real client, routes, storage and ReactStore", () => {
  it("persists annotated nonpass, changed grading pass, and reload through the real transport contract", async () => {
    const store = await open();
    await begin(store);
    edit(store);
    mocks.generate.mockResolvedValueOnce({
      object: {
        verdict: "needs_work",
        issues: ["insufficient_evidence"],
        annotations: [{ start: 0, end: 3, quote: "The", issue: "insufficient_evidence" }],
      },
    });
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(
        store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-a")?.verdict,
      ).toBe("needs_work"),
    );
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
    expect(
      store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-a")?.annotations[0]
        .quote,
    ).toBe("The");
    edit(
      store,
      "Revised: The narrator changes her mind as new evidence challenges her assumptions.",
    );
    store.dispatch(setReviewGrading("book-a", "elite_professor"));
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
    );
    expect(await count("review_attempt")).toBe(2);
    store.dispose();
    const restored = await open();
    await vi.waitFor(() =>
      expect(
        restored.reviewsSelectors.selectReviewAttempts.select(restored.state, "book-a"),
      ).toHaveLength(2),
    );
    expect(restored.reviewsSelectors.selectReviewLocked.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(
      restored.reviewsSelectors.selectReviewCheckpoint.select(restored.state, "book-a")
        ?.returnLocator,
    ).toBe("return-cfi");
    expect(
      restored.reviewsSelectors.selectReviewAnswerText.select(restored.state, "book-a"),
    ).toContain("Revised:");
  });
  it("recovers an actual chapters_unavailable response once", async () => {
    await replaceChapters([{ index: 0, text: TEXT }]);
    mocks.reupload.mockImplementation(async () => replaceChapters(chapters()));
    const store = await open();
    await begin(store);
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
    expect(responses.filter((r) => r.url.endsWith("/question")).map((r) => r.status)).toEqual([
      409, 200,
    ]);
  });
  it("cannot restart a cancelled real-route request after legacy reupload resolves", async () => {
    await replaceChapters([{ index: 0, text: TEXT }]);
    const upload = deferred<void>();
    mocks.reupload.mockReturnValue(upload.promise);
    const store = await open();
    store.dispatch(setReviewsEnabled("book-a", true));
    store.dispatch(startReviewCheckpoint("book-a", 0, chapters()[0].reviewBoundaries[0], null));
    await vi.waitFor(() => expect(mocks.reupload).toHaveBeenCalledTimes(1));
    store.dispatch(setReviewsEnabled("book-a", false));
    await replaceChapters(chapters());
    upload.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(responses.filter((r) => r.url.endsWith("/question"))).toHaveLength(1);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(false);
  });
  it("invalidates cached pass when an authoritative progress refresh excludes replaced source", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters(chapters(`${TEXT} Completely new source.`));
    expect(await reviewClient.progress("book-a", new AbortController().signal)).toEqual({
      progress: [],
      attempts: [],
    });
    store.dispatch(refreshReviewProgress("book-a"));
    await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    const history = store.state.reviews.cache!.attempts;
    const draft = store.reviewsSelectors.selectReviewDocument.select(store.state, "book-a");
    store.dispose();
    vi.stubGlobal("navigator", { onLine: false });
    const restored = await open();
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(restored.reviewsSelectors.selectReviewDocument.select(restored.state, "book-a")).toEqual(
      draft,
    );
    expect(restored.state.reviews.cache?.attempts).toEqual(history);
    expect(
      restored.reviewsSelectors.selectReviewCheckpoint.select(restored.state, "book-a")
        ?.returnLocator,
    ).toBe("return-cfi");
    vi.stubGlobal("navigator", { onLine: true });
    window.dispatchEvent(new Event("online"));
    const previousQuestion = restored.reviewsSelectors.selectReviewQuestion.select(
      restored.state,
      "book-a",
    )!.id;
    restored.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(
        restored.reviewsSelectors.selectReviewQuestion.select(restored.state, "book-a")?.id,
      ).not.toBe(previousQuestion),
    );
    expect(
      restored.reviewsSelectors.selectReviewAssignmentCurrent.select(restored.state, "book-a"),
    ).toBe(true);
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(restored.state.reviews.cache?.drafts.ids).toHaveLength(1);
    expect(restored.state.reviews.cache?.attempts).toEqual(history);
  });
  it("does not carry a cached pass across an explicitly unsupported replacement source", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters(chapters("x".repeat(80_001)));
    store.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.question.error?.code).toBe("unsupported_source"),
    );
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  });
  it("retains source invalidation when repairing a legacy replacement upload fails", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters([{ index: 0, text: TEXT }]);
    mocks.reupload.mockRejectedValueOnce(new Error("Local EPUB unavailable"));
    store.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.question.error?.code).toBe("chapters_unavailable"),
    );
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-a")).toHaveLength(
      1,
    );
    store.dispatch(setReviewsEnabled("book-a", false));
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(false);
  });
});

it("keeps an oversized draft reloadable after rejecting its submission", async () => {
  const store = await open();
  await begin(store);
  edit(store, "x".repeat(1_000_001));
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.state.reviews.requests.submit.error?.code).toBe("invalid_request"),
  );
  await loadReviewCache(U1, "book-a");
  store.dispose();
  const restored = createAppStore();
  restored.init();
  stores.push(restored);
  restored.runSaga(createReviewsSaga(restored));
  restored.dispatch(authSessionResolved({ id: U1, displayName: null }));
  restored.dispatch(openReviewBook("book-a"));
  await vi.waitFor(() => expect(restored.state.reviews.localStatus).not.toBe("loading"));
  expect(restored.state.reviews.localStatus).toBe("ready");
  expect(
    restored.reviewsSelectors.selectReviewAnswerText.select(restored.state, "book-a"),
  ).toHaveLength(1_000_001);
  await vi.waitFor(() => expect(restored.state.reviews.requests.question.token).toBeNull());
  edit(
    restored,
    "The repaired answer relates the narrator's changing perspective to the chapter's evidence.",
  );
  restored.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      true,
    ),
  );
});
