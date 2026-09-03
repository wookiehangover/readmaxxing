import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewCache } from "../reviews-types";
import type {
  ReviewQuestionResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
} from "~/lib/review/review-types";

const mocks = vi.hoisted(() => ({
  question: vi.fn(),
  submit: vi.fn(),
  progress: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  reupload: vi.fn(),
}));
vi.mock("~/lib/review/review-client", async (original) => ({
  ...(await original<typeof import("~/lib/review/review-client")>()),
  reviewClient: { question: mocks.question, submit: mocks.submit, progress: mocks.progress },
}));
vi.mock("~/lib/review/review-cache", () => ({
  loadReviewCache: mocks.load,
  saveReviewCache: mocks.save,
}));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ reuploadBookChapters: mocks.reupload }));

import { ReviewClientError } from "~/lib/review/review-client";
import {
  authSessionCleared,
  authSessionResolved,
} from "~/lib/themis/auth-session/auth-session-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { createReviewsSaga } from "./reviews-saga";
import {
  backtrackReview,
  editReviewDraft,
  openReviewBook,
  refreshReviewProgress,
  retryReviewPersistence,
  retryReviewQuestion,
  setReviewDifficulty,
  setReviewGrading,
  setReviewsEnabled,
  startReviewCheckpoint,
  submitReviewAnswer,
} from "../reviews-slice";
import {
  boundary,
  deferred,
  document,
  questionResponse,
  submitResponse,
} from "../reviews-test-fixtures";

const stores: AppStore[] = [];
const saved = new Map<string, ReviewCache>();
beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.load.mockImplementation(
    async (userId, bookId) => saved.get(JSON.stringify([userId, bookId])) ?? null,
  );
  mocks.save.mockImplementation(async (cache: ReviewCache) => {
    saved.set(JSON.stringify([cache.userId, cache.bookId]), structuredClone(cache));
  });
  mocks.question.mockImplementation(async ({ bookId, chapterKey }) =>
    questionResponse(
      bookId,
      "user-1",
      chapterKey === boundary.key
        ? boundary
        : { ...boundary, key: chapterKey, start: { ...boundary.start, spineIndex: 1 } },
    ),
  );
  mocks.submit.mockImplementation(async (request: ReviewSubmitRequest) => submitResponse(request));
  mocks.progress.mockImplementation(async (bookId: string) => ({
    // A complete snapshot includes assignments already created by question requests.
    progress: mocks.question.mock.calls
      .filter(([request]) => request.bookId === bookId)
      .map(
        ([request]) =>
          questionResponse(bookId, "user-1", {
            ...boundary,
            key: request.chapterKey,
          }).progress,
      ),
    attempts: [],
  }));
  mocks.reupload.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  saved.clear();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
async function setup(userId = "user-1", bookId = "book-1") {
  const store = createAppStore();
  store.init();
  stores.push(store);
  store.runSaga(createReviewsSaga(store));
  store.dispatch(authSessionResolved({ id: userId, displayName: null }));
  store.dispatch(openReviewBook(bookId));
  await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("ready"));
  return store;
}
async function begin(store: AppStore) {
  store.dispatch(setReviewsEnabled("book-1", true));
  store.dispatch(startReviewCheckpoint("book-1", 0, boundary, "epubcfi(/6/2)"));
  await vi.waitFor(() =>
    expect(
      store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1"),
    ).not.toBeNull(),
  );
}
function edit(store: AppStore, text?: string) {
  const assignment = store.reviewsSelectors.selectReviewAssignment.select(store.state, "book-1")!;
  store.dispatch(editReviewDraft("book-1", assignment.id, document(text), 10));
}

describe("review workflows through the configured ReactStore runtime", () => {
  it("hydrates, persists backtracking/drafts, and restores active review on reload", async () => {
    const first = await setup();
    await begin(first);
    edit(first);
    first.dispatch(backtrackReview("book-1"));
    await vi.waitFor(() =>
      expect(saved.get(JSON.stringify(["user-1", "book-1"]))?.presentation).toBe("reading"),
    );
    const restored = await setup();
    expect(restored.reviewsSelectors.selectReviewLocked.select(restored.state, "book-1")).toBe(
      true,
    );
    expect(restored.reviewsSelectors.selectReviewVisible.select(restored.state, "book-1")).toBe(
      false,
    );
    expect(restored.reviewsSelectors.selectReviewDocument.select(restored.state, "book-1")).toEqual(
      document(),
    );
    expect(
      restored.reviewsSelectors.selectReviewCheckpoint.select(restored.state, "book-1")
        ?.returnLocator,
    ).toBe("epubcfi(/6/2)");
  });
  it("reuploads legacy chapter metadata once and keeps unresolved generation retryable", async () => {
    const unavailable = new ReviewClientError(
      { code: "chapters_unavailable", error: "Old upload" },
      409,
    );
    mocks.question.mockRejectedValueOnce(unavailable).mockRejectedValueOnce(unavailable);
    const store = await setup();
    store.dispatch(setReviewsEnabled("book-1", true));
    store.dispatch(startReviewCheckpoint("book-1", 0, boundary, null));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.question.error?.code).toBe("chapters_unavailable"),
    );
    expect(mocks.question).toHaveBeenCalledTimes(2);
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
    store.dispatch(retryReviewQuestion("book-1"));
    await vi.waitFor(() =>
      expect(
        store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1"),
      ).not.toBeNull(),
    );
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
  });
  it("aborts generation immediately on disable and ignores a late response", async () => {
    const late = deferred<ReviewQuestionResponse>();
    mocks.question.mockReturnValueOnce(late.promise);
    const store = await setup();
    store.dispatch(setReviewsEnabled("book-1", true));
    store.dispatch(startReviewCheckpoint("book-1", 0, boundary, null));
    await vi.waitFor(() => expect(mocks.question).toHaveBeenCalledTimes(1));
    const signal = mocks.question.mock.calls[0][1] as AbortSignal;
    store.dispatch(setReviewsEnabled("book-1", false));
    expect(signal.aborted).toBe(true);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    late.resolve(questionResponse());
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1")).toBeNull();
  });
  it("persists stable attempt ids before grading, retries unchanged snapshots, and mints ids after edits/grading changes", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    mocks.submit.mockRejectedValueOnce(new Error("Network"));
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(store.state.reviews.requests.submit.error).not.toBeNull());
    const first = mocks.submit.mock.calls[0][0] as ReviewSubmitRequest;
    expect(saved.get(JSON.stringify(["user-1", "book-1"]))?.submission?.id).toBe(first.id);
    mocks.submit.mockImplementation(async (request) => submitResponse(request, "needs_work"));
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0]).toEqual(first);
    await vi.waitFor(() => expect(store.state.reviews.requests.submit.token).toBeNull());
    edit(store, "A revised answer with additional context and explanation.");
    store.dispatch(setReviewGrading("book-1", "elite_professor"));
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3));
    expect(mocks.submit.mock.calls[2][0].id).not.toBe(first.id);
    expect(mocks.submit.mock.calls[2][0].grading).toBe("elite_professor");
    expect(
      store.reviewsSelectors.selectReviewAttempts
        .select(store.state, "book-1")
        .find((attempt) => attempt.id === first.id)?.grading,
    ).toBe("reading_group");
  });
  it("retains retry id through reload after a lost grading response", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    mocks.submit.mockRejectedValueOnce(new Error("Lost response"));
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(store.state.reviews.requests.submit.error).not.toBeNull());
    const id = mocks.submit.mock.calls[0][0].id;
    const restored = await setup();
    restored.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][0].id).toBe(id);
  });
  it("does not send grading before the retry id is durably saved", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    mocks.save.mockRejectedValue(new Error("Quota exceeded"));
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.submit.error?.error).toContain("Quota exceeded"),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("ignores stale passing grades after editing and leaves the new draft locked", async () => {
    const late = deferred<ReviewSubmitResponse>();
    mocks.submit.mockReturnValueOnce(late.promise);
    const store = await setup();
    await begin(store);
    edit(store);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [request, signal] = mocks.submit.mock.calls[0];
    edit(store, "A changed answer that must not inherit the pending grade.");
    expect(signal.aborted).toBe(true);
    late.resolve(submitResponse(request));
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-1")).toEqual([]);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
  });
  it("releases a passed chapter and starts a later review with the next difficulty", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    store.dispatch(setReviewDifficulty("book-1", "challenging"));
    expect(mocks.question).toHaveBeenCalledTimes(1);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() =>
      expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false),
    );
    const next = {
      ...boundary,
      key: "review-v1:1:0",
      start: { ...boundary.start, spineIndex: 1 },
      end: null,
    };
    store.dispatch(startReviewCheckpoint("book-1", 1, next, "next-cfi"));
    await vi.waitFor(() => expect(mocks.question).toHaveBeenCalledTimes(2));
    expect(mocks.question.mock.calls[1][0].difficulty).toBe("challenging");
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
  });
  it("keeps a pending request alive for other-book actions, no-op auth refresh, and duplicate submit clicks", async () => {
    const late = deferred<ReviewSubmitResponse>();
    mocks.submit.mockReturnValueOnce(late.promise);
    const store = await setup();
    await begin(store);
    edit(store);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [request, signal] = mocks.submit.mock.calls[0];
    store.dispatch(submitReviewAnswer("book-2"));
    store.dispatch(setReviewGrading("book-2", "elite_professor"));
    store.dispatch(authSessionResolved({ id: "user-1", displayName: "Updated" }));
    store.dispatch(submitReviewAnswer("book-1"));
    expect(signal.aborted).toBe(false);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    late.resolve(submitResponse(request));
    await vi.waitFor(() =>
      expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-1")).toBe(true),
    );
  });
  it("isolates books and accounts and prevents stale hydration from showing old drafts", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    const oldCache = store.state.reviews.cache!;
    const loading = deferred<ReviewCache>();
    mocks.load.mockReturnValueOnce(loading.promise);
    store.dispatch(openReviewBook("book-2"));
    expect(store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1")).toBeNull();
    store.dispatch(authSessionResolved({ id: "user-2", displayName: null }));
    await vi.waitFor(() => expect(store.state.reviews.cache?.userId).toBe("user-2"));
    loading.resolve(oldCache);
    await Promise.resolve();
    expect(store.state.reviews.cache?.userId).toBe("user-2");
    expect(store.state.reviews.cache?.drafts.ids).toEqual([]);
    store.dispatch(authSessionCleared());
    expect(store.state.reviews.cache).toBeNull();
  });
  it("supports offline draft edits/disable and surfaces online requirements", async () => {
    const store = await setup();
    await begin(store);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    edit(store);
    expect(store.reviewsSelectors.selectReviewRequirement.select(store.state, "book-1")).toBe(
      "online",
    );
    store.dispatch(submitReviewAnswer("book-1"));
    expect(mocks.submit).not.toHaveBeenCalled();
    store.dispatch(setReviewsEnabled("book-1", false));
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    expect(store.reviewsSelectors.selectReviewDocument.select(store.state, "book-1")).toEqual(
      document(),
    );
  });
  it("cancels progress that could otherwise unlock a checkpoint after an edit", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    const loading = deferred<{ progress: []; attempts: [] }>();
    mocks.progress.mockReturnValueOnce(loading.promise);
    store.dispatch(refreshReviewProgress("book-1"));
    const signal = mocks.progress.mock.calls.at(-1)![1];
    edit(store, "Changed while progress was still loading from the server.");
    expect(signal.aborted).toBe(true);
    loading.resolve({ progress: [], attempts: [] });
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
  });
  it("keeps a failed cache read recoverable without overwriting stored drafts", async () => {
    mocks.load.mockRejectedValueOnce(new Error("Temporary IDB error"));
    const store = createAppStore();
    store.init();
    stores.push(store);
    store.runSaga(createReviewsSaga(store));
    store.dispatch(authSessionResolved({ id: "user-1", displayName: null }));
    store.dispatch(openReviewBook("book-1"));
    await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("failed"));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(store.reviewsSelectors.selectReviewRequirement.select(store.state, "book-1")).toBe(
      "storage",
    );
    store.dispatch(retryReviewPersistence("book-1"));
    await vi.waitFor(() => expect(store.state.reviews.localStatus).toBe("ready"));
  });
  it("aborts grading when switching books and cannot unlock the new book", async () => {
    const late = deferred<ReviewSubmitResponse>();
    mocks.submit.mockReturnValueOnce(late.promise);
    const store = await setup();
    await begin(store);
    edit(store);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [request, signal] = mocks.submit.mock.calls[0];
    store.dispatch(openReviewBook("book-2"));
    expect(signal.aborted).toBe(true);
    await vi.waitFor(() => expect(store.state.reviews.cache?.bookId).toBe("book-2"));
    late.resolve(submitResponse(request));
    await Promise.resolve();
    expect(store.state.reviews.cache?.attempts.ids).toEqual([]);
    expect(store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1")).toBeNull();
  });
  it("cancels grading on disable, preserving the retry id and draft", async () => {
    const late = deferred<ReviewSubmitResponse>();
    mocks.submit.mockReturnValueOnce(late.promise);
    const store = await setup();
    await begin(store);
    edit(store);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [request, signal] = mocks.submit.mock.calls[0];
    store.dispatch(setReviewsEnabled("book-1", false));
    expect(signal.aborted).toBe(true);
    late.resolve(submitResponse(request));
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    expect(store.state.reviews.cache?.submission?.id).toBe(request.id);
    expect(store.reviewsSelectors.selectReviewDocument.select(store.state, "book-1")).toEqual(
      document(),
    );
    expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-1")).toEqual([]);
  });
  it("removes connectivity listeners when the runtime is disposed", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const store = await setup();
    store.dispose();
    expect(remove).toHaveBeenCalledWith("online", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("offline", expect.any(Function));
  });
  it("aborts a progress read started during generation when a newer question arrives", async () => {
    const store = await setup();
    await begin(store);
    const question = deferred<ReviewQuestionResponse>();
    const progress = deferred<{ progress: []; attempts: [] }>();
    mocks.question.mockReturnValueOnce(question.promise);
    mocks.progress.mockReturnValueOnce(progress.promise);
    store.dispatch(retryReviewQuestion("book-1"));
    store.dispatch(refreshReviewProgress("book-1"));
    const signal = mocks.progress.mock.calls.at(-1)![1];
    question.resolve(questionResponse());
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    progress.resolve({ progress: [], attempts: [] });
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewAssignmentCurrent.select(store.state, "book-1")).toBe(
      true,
    );
  });
  it("aborts a pending grade when a newer full snapshot invalidates its source", async () => {
    const store = await setup();
    await begin(store);
    edit(store);
    const grade = deferred<ReviewSubmitResponse>();
    mocks.submit.mockReturnValueOnce(grade.promise);
    store.dispatch(submitReviewAnswer("book-1"));
    await vi.waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    const [request, signal] = mocks.submit.mock.calls[0];
    mocks.progress.mockResolvedValueOnce({ progress: [], attempts: [] });
    store.dispatch(refreshReviewProgress("book-1"));
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    grade.resolve(submitResponse(request));
    await Promise.resolve();
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-1")).toBe(false);
    expect(store.reviewsSelectors.selectReviewDocument.select(store.state, "book-1")).toEqual(
      document(),
    );
  });
  it("hydrates authoritative completed attempts after a question assignment even if the startup progress request was cancelled", async () => {
    const initial = deferred<{ progress: []; attempts: [] }>();
    mocks.progress.mockReturnValueOnce(initial.promise);
    const result = submitResponse({
      id: "server-pass",
      bookId: "book-1",
      chapterKey: boundary.key,
      questionId: questionResponse().question.id,
      grading: "reading_group",
      document: document(),
      plainText: "A thoughtful answer with more than thirty characters.",
    });
    mocks.progress.mockResolvedValue({ progress: [result.progress], attempts: [result.attempt] });
    const store = await setup();
    await begin(store);
    await vi.waitFor(() =>
      expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-1")).toBe(true),
    );
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    expect(
      store.reviewsSelectors.selectReviewPreferences.select(store.state, "book-1").enabled,
    ).toBe(true);
    initial.resolve({ progress: [], attempts: [] });
  });
});
