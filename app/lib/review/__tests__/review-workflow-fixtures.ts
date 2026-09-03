import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import type { ReviewSubmitRequest } from "~/lib/review/review-types";

const dependencies = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  generate: vi.fn(),
  reupload: vi.fn(),
}));
vi.mock("~/lib/database/pool", () => ({ getPool: () => ({ query: dependencies.query }) }));
vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: dependencies.auth }));
vi.mock("ai", () => ({ generateObject: dependencies.generate }));
vi.mock("@ai-sdk/gateway", () => ({ gateway: () => ({ id: "mock-model" }) }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ reuploadBookChapters: dependencies.reupload }));
export const mocks = dependencies;
import { action as questionAction } from "~/routes/api.reviews.question";
import { action as attemptAction } from "~/routes/api.reviews.attempts";
import { loader as progressLoader } from "~/routes/api.reviews.progress";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const KEY = "review-v1:0:0";
export const TEXT =
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

export function chapters(text = TEXT) {
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
export async function replaceChapters(value: unknown, bookId = "book-a") {
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
export async function count(table: "review_attempt" | "review_question") {
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
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { createReviewsSaga } from "~/lib/themis/reviews/sagas/reviews-saga";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import {
  openReviewBook,
  setReviewsEnabled,
  startReviewCheckpoint,
  editReviewDraft,
  submitReviewAnswer,
} from "~/lib/themis/reviews/reviews-slice";

const stores: AppStore[] = [];
export const responses: { url: string; status: number; data: unknown }[] = [];
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
type ProcessedResponse = { status: number; data: unknown; signal: AbortSignal | null };
const heldResponses = new Map<
  string,
  {
    processed: ReturnType<typeof deferred<ProcessedResponse>>;
    delivery: ReturnType<typeof deferred<void>>;
  }
>();
const releases = new Set<() => void>();
/** Hold HTTP delivery only after the real route has processed its database work. */
export function holdNextResponse(operation: "question" | "attempts" | "progress") {
  const processed = deferred<ProcessedResponse>();
  const delivery = deferred<void>();
  heldResponses.set(operation, { processed, delivery });
  releases.add(delivery.resolve);
  return { processed: processed.promise, release: delivery.resolve };
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
    const operation = path.split("/").at(-1)!;
    const held = heldResponses.get(operation);
    heldResponses.delete(operation);
    const result = await (path.endsWith("/question")
      ? questionAction({ request: req })
      : path.endsWith("/attempts")
        ? attemptAction({ request: req })
        : progressLoader({ request: req }));
    const data: unknown = await result.clone().json();
    responses.push({ url, status: result.status, data });
    if (held) {
      held.processed.resolve({ status: result.status, data, signal: init.signal ?? null });
      await held.delivery.promise;
    }
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  });
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose();
  for (const release of releases) release();
  releases.clear();
  heldResponses.clear();
  await loadReviewCache(U1, "book-a").catch(() => null);
  vi.unstubAllGlobals();
});
export async function open() {
  const store = createAppStore();
  store.init();
  stores.push(store);
  store.runSaga(createReviewsSaga(store));
  store.dispatch(authSessionResolved({ id: U1, displayName: null }));
  store.dispatch(openReviewBook("book-a"));
  await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("ready"));
  return store;
}
export async function begin(store: AppStore) {
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
export function edit(
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
export async function pass(store: AppStore) {
  edit(store);
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
  );
}
