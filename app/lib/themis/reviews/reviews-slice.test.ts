import { afterEach, describe, expect, it } from "vitest";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { emptyReviewCache, reviewAssignmentId } from "./reviews-records";
import {
  boundary,
  document,
  fingerprint,
  questionResponse,
  submitResponse,
} from "./reviews-test-fixtures";
import {
  backtrackReview,
  editReviewDraft,
  openReviewBook,
  reviewAttemptReceived,
  reviewCacheLoaded,
  reviewCheckpointEntered,
  reviewProgressReceived,
  reviewQuestionReceived,
  reviewRequestStarted,
  reviewSubmissionPrepared,
  reviewsInitialState,
  reviewsReducer,
  setReviewDifficulty,
  setReviewGrading,
  setReviewsEnabled,
  showReview,
} from "./reviews-slice";

const stores: AppStore[] = [];
function setup() {
  const store = createAppStore();
  store.init();
  stores.push(store);
  store.dispatch(authSessionResolved({ id: "user-1", displayName: null }));
  store.dispatch(openReviewBook("book-1"));
  store.dispatch(
    reviewCacheLoaded(store.state.reviews.generation, emptyReviewCache("user-1", "book-1")),
  );
  return store;
}
function assign(store: AppStore) {
  store.dispatch(setReviewsEnabled("book-1", true));
  store.dispatch(reviewCheckpointEntered("book-1", 0, boundary, "epubcfi(/6/2)"));
  const generation = store.state.reviews.generation;
  store.dispatch(reviewRequestStarted(generation, "question", "question-request"));
  store.dispatch(reviewQuestionReceived(generation, "question-request", questionResponse()));
}
function receiveAttempt(store: AppStore, id: string, verdict: "pass" | "fail", time: number) {
  const generation = store.state.reviews.generation;
  const assignmentId = reviewAssignmentId(boundary.key, fingerprint);
  store.dispatch(editReviewDraft("book-1", assignmentId, document(), time));
  store.dispatch(
    reviewSubmissionPrepared(generation, {
      id,
      draftId: assignmentId,
      draftRevision: 1,
      grading: "reading_group",
    }),
  );
  store.dispatch(reviewRequestStarted(generation, "submit", id));
  store.dispatch(
    reviewAttemptReceived(
      generation,
      id,
      submitResponse(
        {
          id,
          bookId: "book-1",
          chapterKey: boundary.key,
          questionId: questionResponse().question.id,
          grading: "reading_group",
          document: document(),
          plainText: "A thoughtful answer with more than thirty characters.",
        },
        verdict,
        time,
      ),
    ),
  );
}
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
});

describe("canonical review state and derived selectors", () => {
  it("defaults to disabled/Friendly/Reading Group and preserves no-op identity", () => {
    const store = setup();
    expect(store.reviewsSelectors.selectReviewPreferences.select(store.state, "book-1")).toEqual({
      enabled: false,
      difficulty: "friendly",
      grading: "reading_group",
    });
    const initial = store.state.reviews;
    expect(reviewsReducer(initial, setReviewsEnabled("book-1", false))).toBe(initial);
    expect(reviewsReducer(initial, setReviewDifficulty("book-1", "friendly"))).toBe(initial);
    expect(reviewsReducer(initial, setReviewGrading("book-1", "reading_group"))).toBe(initial);
    expect(reviewsReducer(reviewsInitialState, { type: "unknown" })).toBe(reviewsInitialState);
  });
  it("derives lock/presentation and retains the draft and locator on disable/backtracking", () => {
    const store = setup();
    assign(store);
    const id = reviewAssignmentId(boundary.key, fingerprint);
    store.dispatch(editReviewDraft("book-1", id, document(), 3));
    store.dispatch(backtrackReview("book-1"));
    expect(store.reviewsSelectors.selectReviewVisible.select(store.state, "book-1")).toBe(false);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
    store.dispatch(showReview("book-1"));
    expect(store.reviewsSelectors.selectReviewVisible.select(store.state, "book-1")).toBe(true);
    store.dispatch(setReviewsEnabled("book-1", false));
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    expect(
      store.reviewsSelectors.selectReviewDraft.select(store.state, "book-1")?.documentJson,
    ).toBe(JSON.stringify(document()));
    expect(
      store.reviewsSelectors.selectReviewCheckpoint.select(store.state, "book-1")?.returnLocator,
    ).toBe("epubcfi(/6/2)");
  });
  it("derives latest/pass from immutable attempts, retaining a pass after a later failure", () => {
    const store = setup();
    assign(store);
    receiveAttempt(store, "passed", "pass", 2);
    receiveAttempt(store, "failed", "fail", 3);
    expect(
      store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-1")?.document,
    ).toEqual(document());
    expect(
      store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-1")?.annotations,
    ).toEqual([]);
    expect(store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-1")?.id).toBe(
      "failed",
    );
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-1")).toBe(true);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
    expect(
      store.state.reviews.cache?.assignments.map[reviewAssignmentId(boundary.key, fingerprint)],
    ).toEqual({
      id: reviewAssignmentId(boundary.key, fingerprint),
      chapterKey: boundary.key,
      sourceFingerprint: fingerprint,
      questionId: questionResponse().question.id,
    });
    expect(JSON.parse(JSON.stringify(store.state.reviews))).toEqual(store.state.reviews);
  });
  it("ignores wire pass projections without authoritative attempt records", () => {
    const store = setup();
    assign(store);
    const generation = store.state.reviews.generation;
    store.dispatch(reviewRequestStarted(generation, "progress", "progress"));
    store.dispatch(
      reviewProgressReceived(generation, "progress", {
        progress: [{ ...questionResponse().progress, passedAttemptId: "not-loaded" }],
        attempts: [],
      }),
    );
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
  });
  it("keeps generated difficulty fixed while preferences change", () => {
    const store = setup();
    assign(store);
    store.dispatch(setReviewDifficulty("book-1", "adversarial"));
    expect(
      store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1")?.difficulty,
    ).toBe("friendly");
    expect(
      store.reviewsSelectors.selectReviewPreferences.select(store.state, "book-1").difficulty,
    ).toBe("adversarial");
  });
  it("uses canonical paragraph separators and Unicode threshold without storing derived draft text", () => {
    const store = setup();
    assign(store);
    const id = reviewAssignmentId(boundary.key, fingerprint);
    store.dispatch(editReviewDraft("book-1", id, document("😀".repeat(30)), 3));
    expect(store.reviewsSelectors.selectReviewCanSubmit.select(store.state, "book-1")).toBe(false);
    store.dispatch(editReviewDraft("book-1", id, document("😀".repeat(31)), 4));
    expect(store.reviewsSelectors.selectReviewCanSubmit.select(store.state, "book-1")).toBe(true);
    expect(
      store.reviewsSelectors.selectReviewDraft.select(store.state, "book-1"),
    ).not.toHaveProperty("plainText");
    const twoParagraphs = {
      type: "doc",
      content: [...document("First").content!, ...document("Second").content!],
    };
    store.dispatch(editReviewDraft("book-1", id, twoParagraphs, 5));
    expect(store.reviewsSelectors.selectReviewAnswerText.select(store.state, "book-1")).toBe(
      "First\n\nSecond",
    );
  });
  it("rejects late generation after disable and hides records immediately on account/book changes", () => {
    const store = setup();
    assign(store);
    const generation = store.state.reviews.generation;
    store.dispatch(reviewRequestStarted(generation, "question", "late"));
    store.dispatch(setReviewsEnabled("book-1", false));
    const disabled = store.state.reviews;
    store.dispatch(
      reviewQuestionReceived(generation, "late", {
        ...questionResponse(),
        question: { ...questionResponse().question, question: "Late" },
      }),
    );
    expect(store.state.reviews).toBe(disabled);
    store.dispatch(openReviewBook("book-2"));
    expect(store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-1")).toBeNull();
    store.dispatch(authSessionResolved({ id: "user-2", displayName: null }));
    expect(store.state.reviews.cache).toBeNull();
    expect(
      reviewsReducer(
        store.state.reviews,
        reviewCacheLoaded(generation, emptyReviewCache("user-1", "book-1")),
      ),
    ).toBe(store.state.reviews);
  });
  it("invalidates grading and progress responses on editing, preserving the new draft", () => {
    const store = setup();
    assign(store);
    const generation = store.state.reviews.generation;
    const id = reviewAssignmentId(boundary.key, fingerprint);
    store.dispatch(reviewRequestStarted(generation, "submit", "late"));
    store.dispatch(reviewRequestStarted(generation, "progress", "late"));
    store.dispatch(
      editReviewDraft("book-1", id, document("A newer answer changes the whole argument."), 6),
    );
    const changed = store.state.reviews;
    store.dispatch(
      reviewProgressReceived(generation, "late", {
        progress: [questionResponse().progress],
        attempts: [],
      }),
    );
    expect(store.state.reviews).toBe(changed);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
  });
});
