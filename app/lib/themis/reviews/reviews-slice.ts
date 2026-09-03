import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import {
  getItem,
  updateItem,
  upsertItem,
} from "@augmentcode/themis/utils/collections/collection-utils";
import type {
  ReviewApiError,
  ReviewChapterBoundary,
  ReviewDifficulty,
  ReviewGradingLevel,
  ReviewProgressResponse,
  ReviewQuestionResponse,
  ReviewRichTextNode,
  ReviewSubmitResponse,
} from "~/lib/review/review-types";
import {
  authSessionCleared,
  authSessionFailed,
  authSessionResolved,
} from "~/lib/themis/auth-session/auth-session-slice";
import { invalidateReviewSource, mergeReviewProgress, reviewAssignmentId } from "./reviews-records";
import type { ReviewCache, ReviewOperation, ReviewsState, ReviewSubmission } from "./reviews-types";

export const openReviewBook = createAction<[bookId: string | null]>("reviews/openBook");
export const setReviewsEnabled =
  createAction<[bookId: string, enabled: boolean]>("reviews/setEnabled");
export const setReviewDifficulty =
  createAction<[bookId: string, difficulty: ReviewDifficulty]>("reviews/setDifficulty");
export const setReviewGrading =
  createAction<[bookId: string, grading: ReviewGradingLevel]>("reviews/setGrading");
export const startReviewCheckpoint =
  createAction<
    [
      bookId: string,
      chapterIndex: number,
      boundary: ReviewChapterBoundary,
      returnLocator: string | null,
    ]
  >("reviews/startCheckpoint");
export const reviewCheckpointEntered = createAction<Parameters<typeof startReviewCheckpoint>>(
  "reviews/checkpointEntered",
);
export const showReview = createAction<[bookId: string]>("reviews/show");
export const backtrackReview = createAction<[bookId: string]>("reviews/backtrack");
export const editReviewDraft = createAction(
  "reviews/editDraft",
  (bookId: string, assignmentId: string, document: ReviewRichTextNode, updatedAt: number) => ({
    bookId,
    assignmentId,
    documentJson: JSON.stringify(document),
    updatedAt,
  }),
);
export const retryReviewQuestion = createAction<[bookId: string]>("reviews/retryQuestion");
export const submitReviewAnswer = createAction<[bookId: string]>("reviews/submitAnswer");
export const refreshReviewProgress = createAction<[bookId: string]>("reviews/refreshProgress");
export const retryReviewPersistence = createAction<[bookId: string]>("reviews/retryPersistence");

export const reviewConnectivityChanged = createAction<[online: boolean]>(
  "reviews/connectivityChanged",
);
export const reviewCacheLoaded =
  createAction<[generation: number, cache: ReviewCache]>("reviews/cacheLoaded");
export const reviewCacheLoadFailed =
  createAction<[generation: number, error: string]>("reviews/cacheLoadFailed");
export const reviewPersistenceFailed = createAction<[generation: number, error: string | null]>(
  "reviews/persistenceFailed",
);
export const reviewRequestStarted =
  createAction<[generation: number, operation: ReviewOperation, token: string]>(
    "reviews/requestStarted",
  );
export const reviewRequestFailed =
  createAction<
    [generation: number, operation: ReviewOperation, token: string, error: ReviewApiError]
  >("reviews/requestFailed");
export const reviewRequestCancelled = createAction<
  [generation: number, operation: ReviewOperation, token: string]
>("reviews/requestCancelled");
export const reviewQuestionReceived = createAction<
  [generation: number, token: string, response: ReviewQuestionResponse]
>("reviews/questionReceived");
export const reviewProgressReceived = createAction<
  [generation: number, token: string, response: ReviewProgressResponse]
>("reviews/progressReceived");
export const reviewSubmissionPrepared = createAction<
  [generation: number, submission: ReviewSubmission]
>("reviews/submissionPrepared");
export const reviewAttemptReceived =
  createAction<[generation: number, token: string, response: ReviewSubmitResponse]>(
    "reviews/attemptReceived",
  );

const emptyRequests = (): ReviewsState["requests"] => ({
  question: { token: null, error: null },
  progress: { token: null, error: null },
  submit: { token: null, error: null },
});
export const reviewsInitialState: ReviewsState = {
  bookId: null,
  userId: null,
  generation: 0,
  online: true,
  localStatus: "idle",
  cache: null,
  requests: emptyRequests(),
  persistenceError: null,
};

function changeScope(
  state: ReviewsState,
  userId: string | null,
  bookId: string | null,
): ReviewsState {
  if (state.userId === userId && state.bookId === bookId) return state;
  return {
    ...reviewsInitialState,
    online: state.online,
    userId,
    bookId,
    generation: state.generation + 1,
    localStatus: userId && bookId ? "loading" : "idle",
  };
}

function accepts(
  state: ReviewsState,
  generation: number,
  operation: ReviewOperation,
  token: string,
) {
  return (
    state.generation === generation &&
    state.requests[operation].token === token &&
    state.cache !== null
  );
}

const reducer = createReducer<ReviewsState>(reviewsInitialState);
reducer.with(openReviewBook, (state, { payload: [bookId] }) =>
  changeScope(state, state.userId, bookId),
);
reducer.with(authSessionResolved, (state, { payload: [user] }) =>
  changeScope(state, user?.id ?? null, state.bookId),
);
reducer.with(authSessionCleared, (state) => changeScope(state, null, state.bookId));
reducer.with(authSessionFailed, (state) => changeScope(state, null, state.bookId));
reducer.with(reviewConnectivityChanged, (state, { payload: [online] }) =>
  state.online === online ? state : { ...state, online },
);
reducer.with(reviewCacheLoaded, (state, { payload: [generation, cache] }) => {
  if (
    generation !== state.generation ||
    (state.localStatus !== "loading" && state.localStatus !== "failed") ||
    cache.userId !== state.userId ||
    cache.bookId !== state.bookId
  )
    return state;
  return { ...state, cache, localStatus: "ready" };
});
reducer.with(reviewPersistenceFailed, (state, { payload: [generation, error] }) =>
  generation !== state.generation || state.persistenceError === error
    ? state
    : { ...state, persistenceError: error },
);
reducer.with(setReviewsEnabled, (state, { payload: [bookId, enabled] }) => {
  if (!state.cache || bookId !== state.bookId || state.cache.preferences.enabled === enabled)
    return state;
  return {
    ...state,
    generation: state.generation + 1,
    requests: emptyRequests(),
    cache: {
      ...state.cache,
      preferences: { ...state.cache.preferences, enabled },
      presentation: enabled ? state.cache.presentation : "reading",
    },
  };
});
reducer.with(setReviewDifficulty, (state, { payload: [bookId, difficulty] }) => {
  if (!state.cache || bookId !== state.bookId || state.cache.preferences.difficulty === difficulty)
    return state;
  return {
    ...state,
    cache: { ...state.cache, preferences: { ...state.cache.preferences, difficulty } },
  };
});
reducer.with(setReviewGrading, (state, { payload: [bookId, grading] }) => {
  if (!state.cache || bookId !== state.bookId || state.cache.preferences.grading === grading)
    return state;
  const checkpoint = state.cache.activeChapterKey
    ? getItem(state.cache.checkpoints, state.cache.activeChapterKey)
    : null;
  const current =
    checkpoint?.sourceFingerprint &&
    state.cache.currentAssignmentIds.includes(
      reviewAssignmentId(checkpoint.key, checkpoint.sourceFingerprint),
    );
  return {
    ...state,
    requests: {
      ...state.requests,
      submit: { token: null, error: null },
      progress: current ? { token: null, error: null } : state.requests.progress,
    },
    cache: { ...state.cache, preferences: { ...state.cache.preferences, grading } },
  };
});
reducer.with(
  reviewCheckpointEntered,
  (state, { payload: [bookId, chapterIndex, boundary, returnLocator] }) => {
    const cache = state.cache;
    if (!cache?.preferences.enabled || bookId !== state.bookId) return state;
    const existing = getItem(cache.checkpoints, boundary.key);
    return {
      ...state,
      requests: emptyRequests(),
      cache: {
        ...cache,
        checkpoints: upsertItem(cache.checkpoints, {
          ...boundary,
          chapterIndex,
          sourceFingerprint: existing?.sourceFingerprint ?? null,
          returnLocator: returnLocator ?? existing?.returnLocator ?? null,
        }),
        activeChapterKey: boundary.key,
        presentation: "review",
      },
    };
  },
);
reducer.with(showReview, (state, { payload: [bookId] }) =>
  !state.cache?.activeChapterKey ||
  !state.cache.preferences.enabled ||
  bookId !== state.bookId ||
  state.cache.presentation === "review"
    ? state
    : { ...state, cache: { ...state.cache, presentation: "review" } },
);
reducer.with(backtrackReview, (state, { payload: [bookId] }) =>
  !state.cache || bookId !== state.bookId || state.cache.presentation === "reading"
    ? state
    : { ...state, cache: { ...state.cache, presentation: "reading" } },
);
reducer.with(editReviewDraft, (state, { payload }) => {
  const cache = state.cache;
  if (
    !cache ||
    payload.bookId !== state.bookId ||
    !getItem(cache.assignments, payload.assignmentId)
  )
    return state;
  const previous = getItem(cache.drafts, payload.assignmentId);
  if (previous?.documentJson === payload.documentJson) return state;
  return {
    ...state,
    requests: {
      ...state.requests,
      submit: { token: null, error: null },
      // Editing cannot cancel confirmation of an already completed write. It
      // still invalidates reads that could import a not-yet-accepted grade.
      progress: cache.currentAssignmentIds.includes(payload.assignmentId)
        ? { token: null, error: null }
        : state.requests.progress,
    },
    cache: {
      ...cache,
      drafts: upsertItem(cache.drafts, {
        id: payload.assignmentId,
        documentJson: payload.documentJson,
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: payload.updatedAt,
      }),
    },
  };
});
reducer.with(reviewRequestStarted, (state, { payload: [generation, operation, token] }) =>
  generation !== state.generation || !state.cache
    ? state
    : {
        ...state,
        requests: {
          ...state.requests,
          // A read begun before this write cannot reconcile its newer result.
          ...(operation !== "progress" ? { progress: { token: null, error: null } } : {}),
          [operation]: { token, error: null },
        },
      },
);
reducer.with(reviewRequestFailed, (state, { payload: [generation, operation, token, error] }) => {
  if (!accepts(state, generation, operation, token) || !state.cache) return state;
  const sourceInvalid = [
    "source_changed",
    "unsupported_source",
    "chapters_unavailable",
    "book_not_found",
  ].includes(error.code);
  return {
    ...state,
    cache: sourceInvalid
      ? invalidateReviewSource(
          state.cache,
          operation === "progress" || error.code === "book_not_found"
            ? null
            : state.cache.activeChapterKey,
        )
      : state.cache,
    requests: {
      ...(sourceInvalid ? emptyRequests() : state.requests),
      [operation]: { token: null, error },
    },
  };
});
reducer.with(reviewQuestionReceived, (state, { payload: [generation, token, response] }) => {
  if (!accepts(state, generation, "question", token) || !state.cache) return state;
  const { chapter, question, progress } = response;
  if (
    chapter.bookId !== state.bookId ||
    chapter.chapterKey !== state.cache.activeChapterKey ||
    progress.userId !== state.userId ||
    progress.bookId !== state.bookId ||
    progress.questionId !== question.id ||
    chapter.sourceFingerprint !== question.sourceFingerprint ||
    progress.sourceFingerprint !== chapter.sourceFingerprint ||
    progress.chapterKey !== chapter.chapterKey
  )
    return state;
  const { key: _key, ...boundary } = chapter.boundary;
  const previous = getItem(state.cache.checkpoints, chapter.chapterKey);
  const assignmentId = reviewAssignmentId(chapter.chapterKey, chapter.sourceFingerprint);
  const changed =
    previous?.sourceFingerprint !== chapter.sourceFingerprint ||
    getItem(state.cache.assignments, assignmentId)?.questionId !== question.id;
  let cache = mergeReviewProgress(state.cache, { progress: [progress], attempts: [] });
  cache = {
    ...cache,
    questions: upsertItem(cache.questions, question),
    checkpoints: updateItem(cache.checkpoints, {
      key: chapter.chapterKey,
      ...boundary,
      chapterIndex: chapter.chapterIndex,
      sourceFingerprint: chapter.sourceFingerprint,
    }),
  };
  return {
    ...state,
    // HTTP delivery order cannot prove source freshness. The saga follows every
    // successful write with a fresh snapshot before this assignment can unlock.
    cache: invalidateReviewSource(cache, chapter.chapterKey),
    requests: {
      ...state.requests,
      progress: { token: null, error: null },
      ...(changed ? { submit: { token: null, error: null } } : {}),
      question: { token: null, error: null },
    },
  };
});
reducer.with(reviewProgressReceived, (state, { payload: [generation, token, response] }) => {
  if (!accepts(state, generation, "progress", token) || !state.cache) return state;
  const cache = mergeReviewProgress(state.cache, response, "snapshot");
  const checkpoint = cache.activeChapterKey
    ? getItem(cache.checkpoints, cache.activeChapterKey)
    : null;
  const id = checkpoint?.sourceFingerprint
    ? reviewAssignmentId(checkpoint.key, checkpoint.sourceFingerprint)
    : null;
  const changed =
    id &&
    (!cache.currentAssignmentIds.includes(id) ||
      getItem(cache.assignments, id)?.questionId !==
        getItem(state.cache.assignments, id)?.questionId);
  return {
    ...state,
    cache,
    requests: {
      ...(changed ? emptyRequests() : state.requests),
      progress: { token: null, error: null },
    },
  };
});
reducer.with(reviewSubmissionPrepared, (state, { payload: [generation, submission] }) =>
  state.generation !== generation || !state.cache
    ? state
    : { ...state, cache: { ...state.cache, submission } },
);
reducer.with(reviewAttemptReceived, (state, { payload: [generation, token, response] }) => {
  if (!accepts(state, generation, "submit", token) || !state.cache) return state;
  const { attempt, progress } = response;
  const submission = state.cache.submission;
  if (
    !submission ||
    submission.id !== attempt.id ||
    attempt.userId !== state.userId ||
    attempt.bookId !== state.bookId ||
    progress.userId !== attempt.userId ||
    progress.bookId !== attempt.bookId ||
    progress.chapterKey !== attempt.chapterKey ||
    progress.sourceFingerprint !== attempt.sourceFingerprint ||
    progress.questionId !== attempt.questionId ||
    reviewAssignmentId(attempt.chapterKey, attempt.sourceFingerprint) !== submission.draftId
  )
    return state;
  return {
    ...state,
    cache: invalidateReviewSource(
      mergeReviewProgress(state.cache, { attempts: [attempt], progress: [progress] }),
      attempt.chapterKey,
    ),
    requests: emptyRequests(),
  };
});

reducer.with(reviewRequestCancelled, (state, { payload: [generation, operation, token] }) =>
  !accepts(state, generation, operation, token)
    ? state
    : { ...state, requests: { ...state.requests, [operation]: { token: null, error: null } } },
);

reducer.with(reviewCacheLoadFailed, (state, { payload: [generation, error] }) =>
  generation !== state.generation
    ? state
    : { ...state, localStatus: "failed", persistenceError: error },
);

export const reviewsReducer = reducer;
