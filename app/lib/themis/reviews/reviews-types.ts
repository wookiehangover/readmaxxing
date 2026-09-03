import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import type { fork, SagaGenerator } from "typed-redux-saga";
import type {
  ReviewAnnotation,
  ReviewApiError,
  ReviewAttemptDTO,
  ReviewChapterBoundary,
  ReviewGradingLevel,
  ReviewPreferences,
  ReviewQuestionDTO,
} from "~/lib/review/review-types";

export interface ReviewCheckpoint extends ReviewChapterBoundary {
  chapterIndex: number;
  sourceFingerprint: string | null;
  /** Opaque reader locator (currently an EPUB CFI), owned by navigation. */
  returnLocator: string | null;
}

export interface ReviewAssignment {
  id: string;
  chapterKey: string;
  sourceFingerprint: string;
  questionId: string;
}

export interface ReviewLocalDraft {
  /** Assignment id; scope lives on the containing cache. */
  id: string;
  documentJson: string;
  revision: number;
  updatedAt: number;
}

export interface ReviewSubmission {
  id: string;
  draftId: string;
  draftRevision: number;
  grading: ReviewGradingLevel;
}

/** Immutable server snapshots; rich text is opaque JSON, annotations are normalized. */
export interface ReviewAttempt extends Omit<ReviewAttemptDTO, "document" | "annotations"> {
  documentJson: string;
  annotations: Collection<ReviewAnnotation & { id: string }, "id">;
}

export interface ReviewCache {
  version: 1;
  userId: string;
  bookId: string;
  preferences: ReviewPreferences;
  checkpoints: Collection<ReviewCheckpoint, "key">;
  assignments: Collection<ReviewAssignment, "id">;
  questions: Collection<ReviewQuestionDTO, "id">;
  attempts: Collection<ReviewAttempt, "id">;
  drafts: Collection<ReviewLocalDraft, "id">;
  submission: ReviewSubmission | null;
  activeChapterKey: string | null;
  presentation: "reading" | "review";
}

export type ReviewOperation = "question" | "progress" | "submit";
export type ReviewTask =
  ReturnType<typeof fork> extends Generator<unknown, infer Task, unknown> ? Task : never;
export type ReviewWorker = (action: { type: string; payload?: unknown }) => SagaGenerator<void>;
export interface ReviewRequest {
  token: string | null;
  error: ReviewApiError | null;
}

export interface ReviewsState {
  bookId: string | null;
  userId: string | null;
  generation: number;
  online: boolean;
  localStatus: "idle" | "loading" | "ready" | "failed";
  cache: ReviewCache | null;
  requests: Record<ReviewOperation, ReviewRequest>;
  persistenceError: string | null;
}
