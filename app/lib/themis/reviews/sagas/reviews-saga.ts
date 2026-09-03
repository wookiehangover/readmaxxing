import { call, cancel, fork, put, take, takeLatest } from "typed-redux-saga";
import { takeEveryFromSelector, takeLatestFromSelector } from "@augmentcode/themis/saga";
import { nanoid } from "nanoid";
import { loadReviewCache, saveReviewCache } from "~/lib/review/review-cache";
import { reviewClient, reviewClientError } from "~/lib/review/review-client";
import { reviewSubmitRequestSchema } from "~/lib/review/review-schemas";
import { reuploadBookChapters } from "~/lib/sync/book-chapter-uploads";
import {
  authSessionCleared,
  authSessionFailed,
  authSessionResolved,
} from "~/lib/themis/auth-session/auth-session-slice";
import type { AppStore } from "~/lib/themis/store";
import { emptyReviewCache } from "../reviews-records";
import {
  editReviewDraft,
  openReviewBook,
  refreshReviewProgress,
  retryReviewPersistence,
  retryReviewQuestion,
  reviewAttemptReceived,
  reviewCacheLoaded,
  reviewCacheLoadFailed,
  reviewCheckpointEntered,
  reviewConnectivityChanged,
  reviewPersistenceFailed,
  reviewProgressReceived,
  reviewQuestionReceived,
  reviewRequestFailed,
  reviewRequestStarted,
  reviewRequestCancelled,
  reviewSubmissionPrepared,
  setReviewGrading,
  setReviewsEnabled,
  showReview,
  startReviewCheckpoint,
  submitReviewAnswer,
} from "../reviews-slice";
import type { ReviewOperation, ReviewTask, ReviewWorker } from "../reviews-types";

const scopeActions = [openReviewBook, authSessionCleared, authSessionFailed, authSessionResolved];
const authorityActions = [
  reviewRequestStarted,
  reviewRequestFailed,
  reviewQuestionReceived,
  reviewProgressReceived,
  reviewAttemptReceived,
];
const questionActions = [
  retryReviewQuestion,
  reviewCheckpointEntered,
  reviewCacheLoaded,
  setReviewsEnabled,
  ...authorityActions,
  ...scopeActions,
];
const progressActions = [
  refreshReviewProgress,
  reviewCacheLoaded,
  editReviewDraft,
  setReviewGrading,
  setReviewsEnabled,
  reviewCheckpointEntered,
  ...authorityActions,
  ...scopeActions,
];
const submitActions = [
  submitReviewAnswer,
  editReviewDraft,
  setReviewGrading,
  setReviewsEnabled,
  reviewCheckpointEntered,
  ...authorityActions,
  ...scopeActions,
];

function* withChapterRecovery<Args extends unknown[], Result>(
  bookId: string,
  request: (...args: Args) => Promise<Result>,
  ...args: Args
) {
  try {
    return yield* call(request, ...args);
  } catch (cause) {
    if (reviewClientError(cause).code !== "chapters_unavailable") throw cause;
    try {
      yield* call(reuploadBookChapters, bookId);
    } catch {
      // A failed repair does not undo the server's source-unavailable finding.
      throw cause;
    }
    return yield* call(request, ...args);
  }
}

/** Bound once to the app's configured selectors/dispatch; no module-global Store. */
export function createReviewsSaga(store: AppStore) {
  const selectors = store.reviewsSelectors;

  function* hydrateScope() {
    const state = yield* selectors.selectReviewState.effect();
    if (
      !state.userId ||
      !state.bookId ||
      (state.localStatus !== "loading" && state.localStatus !== "failed")
    )
      return;
    try {
      const cache = yield* call(loadReviewCache, state.userId, state.bookId);
      yield* put(
        reviewCacheLoaded(state.generation, cache ?? emptyReviewCache(state.userId, state.bookId)),
      );
    } catch (cause) {
      yield* put(
        reviewCacheLoadFailed(state.generation, `Could not restore reviews: ${String(cause)}`),
      );
    }
  }

  function* persistCache() {
    const { cache, generation } = yield* selectors.selectReviewState.effect();
    if (!cache) return;
    try {
      yield* call(saveReviewCache, cache);
      yield* put(reviewPersistenceFailed(generation, null));
    } catch (cause) {
      yield* put(reviewPersistenceFailed(generation, `Could not save reviews: ${String(cause)}`));
    }
  }

  function* retryPersistence(action: ReturnType<typeof retryReviewPersistence>) {
    const state = yield* selectors.selectReviewState.effect();
    if (action.payload[0] !== state.bookId) return;
    if (state.cache) yield* call(persistCache);
    else yield* call(hydrateScope);
  }

  function* enterCheckpoint(action: ReturnType<typeof startReviewCheckpoint>) {
    const [bookId, , boundary] = action.payload;
    const cache = yield* selectors.selectReviewCache.effect(bookId);
    if (!cache?.preferences.enabled) return;
    const checkpoint = yield* selectors.selectReviewCheckpoint.effect(bookId);
    const locked = yield* selectors.selectReviewLocked.effect(bookId);
    if (checkpoint?.key === boundary.key) {
      if (locked) yield* put(showReview(bookId));
      return;
    }
    if (locked) return;
    yield* put(reviewCheckpointEntered(...action.payload));
  }

  function* question(action: { type: string; payload?: unknown }) {
    if (scopeActions.some((creator) => creator.type === action.type)) return;
    const state = yield* selectors.selectReviewState.effect();
    const { cache, bookId, generation } = state;
    if (!cache?.preferences.enabled || !bookId || !cache.activeChapterKey) return;
    if (action.type === retryReviewQuestion.type && (action.payload as [string])[0] !== bookId)
      return;
    const token = nanoid();
    yield* put(reviewRequestStarted(generation, "question", token));
    const controller = new AbortController();
    try {
      if (!state.online) throw new Error("Connect to the internet to generate a review question.");
      const request = {
        bookId,
        chapterKey: cache.activeChapterKey,
        difficulty: cache.preferences.difficulty,
      };
      const response = yield* withChapterRecovery(
        bookId,
        reviewClient.question,
        request,
        controller.signal,
      );
      yield* put(reviewQuestionReceived(generation, token, response));
    } catch (cause) {
      yield* put(reviewRequestFailed(generation, "question", token, reviewClientError(cause)));
    } finally {
      controller.abort();
      yield* put(reviewRequestCancelled(generation, "question", token));
    }
  }

  function* progress(action: { type: string; payload?: unknown }) {
    if (
      action.type !== refreshReviewProgress.type &&
      action.type !== reviewCacheLoaded.type &&
      action.type !== reviewQuestionReceived.type &&
      action.type !== reviewAttemptReceived.type
    )
      return;
    const state = yield* selectors.selectReviewState.effect();
    const { bookId, cache, generation } = state;
    if (!cache || !bookId || !state.online) return;
    if (action.type === refreshReviewProgress.type && (action.payload as [string])[0] !== bookId)
      return;
    const token = nanoid();
    yield* put(reviewRequestStarted(generation, "progress", token));
    const controller = new AbortController();
    try {
      const response = yield* call(reviewClient.progress, bookId, controller.signal);
      yield* put(reviewProgressReceived(generation, token, response));
    } catch (cause) {
      yield* put(reviewRequestFailed(generation, "progress", token, reviewClientError(cause)));
    } finally {
      controller.abort();
      yield* put(reviewRequestCancelled(generation, "progress", token));
    }
  }

  function* submit(action: { type: string; payload?: unknown }) {
    if (action.type !== submitReviewAnswer.type) return;
    const [bookId] = action.payload as [string];
    if (!(yield* selectors.selectReviewCanSubmit.effect(bookId))) return;
    const { cache, generation } = yield* selectors.selectReviewState.effect();
    const draft = yield* selectors.selectReviewDraft.effect(bookId);
    const assignment = yield* selectors.selectReviewAssignment.effect(bookId);
    if (!cache || !draft || !assignment) return;
    const previous = cache.submission;
    const submission =
      previous &&
      previous.draftId === draft.id &&
      previous.draftRevision === draft.revision &&
      previous.grading === cache.preferences.grading
        ? previous
        : {
            id: nanoid(),
            draftId: draft.id,
            draftRevision: draft.revision,
            grading: cache.preferences.grading,
          };
    const request = reviewSubmitRequestSchema.safeParse({
      id: submission.id,
      bookId,
      chapterKey: assignment.chapterKey,
      questionId: assignment.questionId,
      grading: submission.grading,
      document: yield* selectors.selectReviewDocument.effect(bookId),
      plainText: yield* selectors.selectReviewAnswerText.effect(bookId),
    });
    const token = nanoid();
    yield* put(reviewRequestStarted(generation, "submit", token));
    if (!request.success) {
      yield* put(
        reviewRequestFailed(generation, "submit", token, {
          code: "invalid_request",
          error: "The answer is too large or has unsupported formatting.",
        }),
      );
      return;
    }
    yield* put(reviewSubmissionPrepared(generation, submission));
    const controller = new AbortController();
    try {
      // Persist the retry identity before the server can commit an attempt.
      const prepared = yield* selectors.selectReviewCache.effect(bookId);
      if (!prepared) return;
      yield* call(saveReviewCache, prepared);
      const response = yield* withChapterRecovery(
        bookId,
        reviewClient.submit,
        request.data,
        controller.signal,
      );
      yield* put(reviewAttemptReceived(generation, token, response));
    } catch (cause) {
      yield* put(reviewRequestFailed(generation, "submit", token, reviewClientError(cause)));
    } finally {
      controller.abort();
      yield* put(reviewRequestCancelled(generation, "submit", token));
    }
  }

  // Validate scope before cancelling; stale callers cannot abort another book's work.
  function* watchOperation(
    operation: ReviewOperation,
    patterns: typeof questionActions | typeof progressActions | typeof submitActions,
    worker: ReviewWorker,
  ) {
    let pending: ReviewTask | null = null;
    let requestGeneration = -1;
    while (true) {
      const action = yield* take(patterns);
      const state = yield* selectors.selectReviewState.effect();
      const scoped = scopeActions.some((creator) => creator.type === action.type);
      if (scoped) {
        if (requestGeneration === state.generation) continue;
      } else if (
        action.type === reviewCacheLoaded.type ||
        authorityActions.some((creator) => creator.type === action.type)
      ) {
        if ((action.payload as [number])[0] !== state.generation) continue;
      } else {
        const bookId =
          action.type === editReviewDraft.type
            ? (action.payload as { bookId: string }).bookId
            : (action.payload as [string])[0];
        if (bookId !== state.bookId) continue;
      }
      const trigger =
        operation === "question"
          ? [
              retryReviewQuestion.type,
              reviewCheckpointEntered.type,
              reviewCacheLoaded.type,
              setReviewsEnabled.type,
            ].includes(action.type)
          : operation === "progress"
            ? [
                refreshReviewProgress.type,
                reviewCacheLoaded.type,
                reviewQuestionReceived.type,
                reviewAttemptReceived.type,
              ].includes(action.type)
            : action.type === submitReviewAnswer.type;
      if (
        state.requests[operation].token &&
        (!trigger || (operation === "submit" && pending?.isRunning()))
      )
        continue;
      if (pending) yield* cancel(pending);
      requestGeneration = state.generation;
      if (trigger) pending = yield* fork(worker, action);
    }
  }

  return function* reviewsSaga() {
    const updateOnline = () => store.dispatch(reviewConnectivityChanged(navigator.onLine));
    if (typeof window !== "undefined") {
      window.addEventListener("online", updateOnline);
      window.addEventListener("offline", updateOnline);
      yield* call(updateOnline);
    }
    try {
      yield* takeLatestFromSelector(selectors.selectReviewScope, hydrateScope);
      yield* takeEveryFromSelector(selectors.selectReviewPersistableCache, persistCache);
      yield* takeLatest(retryReviewPersistence, retryPersistence);
      yield* takeLatest(startReviewCheckpoint, enterCheckpoint);
      yield* fork(watchOperation, "question" as const, questionActions, question);
      yield* fork(watchOperation, "progress" as const, progressActions, progress);
      yield* fork(watchOperation, "submit" as const, submitActions, submit);
      yield* call(hydrateScope);
      // Forked watchers keep the root alive, so cleanup runs only on cancellation.
      yield* call(() => new Promise<never>(() => {}));
    } finally {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", updateOnline);
        window.removeEventListener("offline", updateOnline);
      }
    }
  };
}
