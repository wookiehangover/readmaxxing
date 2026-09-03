import { getItem, getItems } from "@augmentcode/themis/utils/collections/collection-utils";
import { canSubmitReviewAnswer, reviewDocumentPlainText } from "~/lib/review/review-schemas";
import { DEFAULT_REVIEW_PREFERENCES } from "~/lib/review/review-types";
import type { ReviewRichTextNode } from "~/lib/review/review-types";
import type { AppStoreCore } from "~/lib/themis/store";
import { reviewAssignmentId } from "./reviews-records";
import type { ReviewOperation } from "./reviews-types";

export function createReviewsSelectors(store: AppStoreCore) {
  const selectReviewState = store.createSelector((state) => state.reviews);
  const selectReviewScope = store.createSelector((state) =>
    JSON.stringify([state.reviews.userId, state.reviews.bookId]),
  );
  const selectReviewPersistableCache = store.createSelector((state) => state.reviews.cache);
  const selectReviewCache = store.createSelector((state, bookId: string) => {
    const reviews = state.reviews;
    return reviews.bookId === bookId && reviews.userId === state.authSession.user?.id
      ? reviews.cache
      : null;
  });
  const selectReviewPreferences = store.createSelector(
    (state, bookId: string) =>
      selectReviewCache.select(state, bookId)?.preferences ?? DEFAULT_REVIEW_PREFERENCES,
  );
  const selectReviewCheckpoint = store.createSelector((state, bookId: string) => {
    const cache = selectReviewCache.select(state, bookId);
    return cache?.activeChapterKey
      ? (getItem(cache.checkpoints, cache.activeChapterKey) ?? null)
      : null;
  });
  const selectReviewAssignment = store.createSelector((state, bookId: string) => {
    const cache = selectReviewCache.select(state, bookId);
    const checkpoint = selectReviewCheckpoint.select(state, bookId);
    return cache && checkpoint?.sourceFingerprint
      ? (getItem(
          cache.assignments,
          reviewAssignmentId(checkpoint.key, checkpoint.sourceFingerprint),
        ) ?? null)
      : null;
  });
  const selectReviewQuestion = store.createSelector((state, bookId: string) => {
    const cache = selectReviewCache.select(state, bookId);
    const assignment = selectReviewAssignment.select(state, bookId);
    return cache && assignment ? (getItem(cache.questions, assignment.questionId) ?? null) : null;
  });
  const selectReviewDraft = store.createSelector((state, bookId: string) => {
    const cache = selectReviewCache.select(state, bookId);
    const assignment = selectReviewAssignment.select(state, bookId);
    return cache && assignment ? (getItem(cache.drafts, assignment.id) ?? null) : null;
  });
  const selectReviewDocument = store.createSelector((state, bookId: string): ReviewRichTextNode => {
    const draft = selectReviewDraft.select(state, bookId);
    return draft
      ? JSON.parse(draft.documentJson)
      : { type: "doc", content: [{ type: "paragraph" }] };
  });
  const selectReviewAnswerText = store.createSelector((state, bookId: string) =>
    reviewDocumentPlainText(selectReviewDocument.select(state, bookId)),
  );
  const selectReviewAttemptRecords = store.createSelector((state, bookId: string) => {
    const cache = selectReviewCache.select(state, bookId);
    const assignment = selectReviewAssignment.select(state, bookId);
    return cache && assignment
      ? getItems(cache.attempts)
          .filter(
            (attempt) =>
              attempt.chapterKey === assignment.chapterKey &&
              attempt.sourceFingerprint === assignment.sourceFingerprint &&
              attempt.questionId === assignment.questionId,
          )
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      : [];
  });
  const selectReviewAttempts = store.createSelector((state, bookId: string) =>
    selectReviewAttemptRecords
      .select(state, bookId)
      .map(({ documentJson, annotations, ...attempt }) => ({
        ...attempt,
        document: JSON.parse(documentJson) as ReviewRichTextNode,
        annotations: getItems(annotations).map(({ id: _id, ...annotation }) => annotation),
      })),
  );
  const selectLatestReviewAttempt = store.createSelector(
    (state, bookId: string) => selectReviewAttempts.select(state, bookId).at(-1) ?? null,
  );
  const selectReviewPassed = store.createSelector((state, bookId: string) =>
    selectReviewAttemptRecords.select(state, bookId).some((attempt) => attempt.verdict === "pass"),
  );
  const selectReviewLocked = store.createSelector(
    (state, bookId: string) =>
      selectReviewPreferences.select(state, bookId).enabled &&
      selectReviewCheckpoint.select(state, bookId) !== null &&
      !selectReviewPassed.select(state, bookId),
  );
  const selectReviewVisible = store.createSelector(
    (state, bookId: string) =>
      selectReviewPreferences.select(state, bookId).enabled &&
      selectReviewCheckpoint.select(state, bookId) !== null &&
      selectReviewCache.select(state, bookId)?.presentation === "review",
  );
  const selectReviewRequirement = store.createSelector((state, bookId: string) => {
    if (!state.authSession.user) return "sign_in" as const;
    if (state.reviews.bookId === bookId && state.reviews.localStatus === "failed")
      return "storage" as const;
    if (state.reviews.bookId !== bookId || state.reviews.localStatus !== "ready")
      return "loading" as const;
    if (!state.reviews.online) return "online" as const;
    return null;
  });
  const selectReviewRequest = store.createSelector(
    (state, bookId: string, operation: ReviewOperation) =>
      state.reviews.bookId === bookId && state.reviews.userId === state.authSession.user?.id
        ? state.reviews.requests[operation]
        : null,
  );
  const selectReviewPersistenceError = store.createSelector((state, bookId: string) =>
    state.reviews.bookId === bookId && state.reviews.userId === state.authSession.user?.id
      ? state.reviews.persistenceError
      : null,
  );
  const selectReviewAnswerMeetsThreshold = store.createSelector((state, bookId: string) =>
    canSubmitReviewAnswer(selectReviewAnswerText.select(state, bookId)),
  );
  const selectReviewCanSubmit = store.createSelector(
    (state, bookId: string) =>
      selectReviewPreferences.select(state, bookId).enabled &&
      selectReviewQuestion.select(state, bookId) !== null &&
      selectReviewAnswerMeetsThreshold.select(state, bookId) &&
      selectReviewRequirement.select(state, bookId) === null &&
      state.reviews.requests.submit.token === null,
  );
  return {
    selectReviewState,
    selectReviewScope,
    selectReviewPersistableCache,
    selectReviewCache,
    selectReviewPreferences,
    selectReviewCheckpoint,
    selectReviewAssignment,
    selectReviewQuestion,
    selectReviewDraft,
    selectReviewDocument,
    selectReviewAnswerText,
    selectReviewAttempts,
    selectLatestReviewAttempt,
    selectReviewPassed,
    selectReviewLocked,
    selectReviewVisible,
    selectReviewRequirement,
    selectReviewCanSubmit,
    selectReviewRequest,
    selectReviewPersistenceError,
    selectReviewAnswerMeetsThreshold,
  };
}
