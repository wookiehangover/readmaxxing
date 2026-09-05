/** Wire/persistence contracts only: safe to import during SSR and in the browser. */
export const REVIEW_DIFFICULTIES = [
  "friendly",
  "challenging",
  "adversarial",
  "tyler_cowen",
] as const;
export const REVIEW_GRADING_LEVELS = [
  "reading_group",
  "community_college",
  "elite_professor",
  "tyler_cowen",
] as const;
export type ReviewDifficulty = (typeof REVIEW_DIFFICULTIES)[number];
export type ReviewGradingLevel = (typeof REVIEW_GRADING_LEVELS)[number];
export type ReviewVerdict = "pass" | "fail" | "needs_work";

export interface ReviewPreferences {
  enabled: boolean;
  difficulty: ReviewDifficulty;
  grading: ReviewGradingLevel;
}
export const DEFAULT_REVIEW_PREFERENCES: Readonly<ReviewPreferences> = {
  enabled: false,
  difficulty: "friendly",
  grading: "reading_group",
};
export const REVIEW_GENERATION_VERSION = "chapter-review-v1";
export const REVIEW_SCHEMA_VERSION = 1;
export const REVIEW_PROMPT_VERSION = 1;

/** UTF-16 offset in trimmed source body.textContent, never a viewport page number. */
export interface ReviewChapterPoint {
  spineIndex: number;
  href: string;
  fragment: string | null;
  textOffset: number;
}
export interface ReviewChapterBoundary {
  /** Book-local locator identity; unrelated to the global content fingerprint. */
  key: string;
  title: string;
  start: ReviewChapterPoint;
  /** Exclusive. null means the end of the publication. */
  end: ReviewChapterPoint | null;
  /** Slice of the enclosing legacy BookChapter.text; includes multi-spine separators. */
  startOffset: number;
  endOffset: number;
}
export interface ReviewChapterRef {
  bookId: string;
  chapterKey: string;
  sourceFingerprint: string;
}
export interface ReviewChapterDTO extends ReviewChapterRef {
  chapterIndex: number;
  boundary: ReviewChapterBoundary;
}
export interface ReviewQuestionDTO {
  id: string;
  sourceFingerprint: string;
  difficulty: ReviewDifficulty;
  generationVersion: string;
  question: string;
  createdAt: number;
}
export type ReviewJson =
  | null
  | boolean
  | number
  | string
  | ReviewJson[]
  | { [key: string]: ReviewJson };
export interface ReviewRichTextNode {
  type: string;
  text?: string;
  attrs?: Record<string, ReviewJson>;
  marks?: { type: string; attrs?: Record<string, ReviewJson> }[];
  content?: ReviewRichTextNode[];
}
export interface ReviewAnswerSnapshot {
  document: ReviewRichTextNode;
  /** Untrimmed canonical text of document. Annotation offsets refer to this exact string. */
  plainText: string;
}
export interface ReviewAnnotation {
  start: number;
  end: number;
  quote: string;
  feedback: string;
}
export interface ReviewAttemptDTO extends ReviewChapterRef, ReviewAnswerSnapshot {
  id: string;
  userId: string;
  questionId: string;
  grading: ReviewGradingLevel;
  verdict: ReviewVerdict;
  feedback: string;
  annotations: ReviewAnnotation[];
  createdAt: number;
}
export interface ReviewProgressDTO extends ReviewChapterRef {
  userId: string;
  questionId: string;
  latestAttemptId: string | null;
  passedAttemptId: string | null;
  updatedAt: number;
}
/** Local-only, account-scoped draft. Never push as a graded attempt or shared question. */
export interface ReviewDraft extends ReviewChapterRef, ReviewAnswerSnapshot {
  userId: string;
  questionId: string;
  updatedAt: number;
}

/** POST /api/reviews/question; no client-supplied text, fingerprint, rubric or model. */
export interface ReviewQuestionRequest {
  bookId: string;
  chapterKey: string;
  difficulty: ReviewDifficulty;
}
export interface ReviewQuestionResponse {
  chapter: ReviewChapterDTO;
  question: ReviewQuestionDTO;
  progress: ReviewProgressDTO;
}
/** POST /api/reviews/attempts; id is an idempotency key retained across transport retries. */
export interface ReviewSubmitRequest extends ReviewAnswerSnapshot {
  id: string;
  bookId: string;
  chapterKey: string;
  questionId: string;
  grading: ReviewGradingLevel;
}
export interface ReviewSubmitResponse {
  attempt: ReviewAttemptDTO;
  progress: ReviewProgressDTO;
}
/** GET /api/reviews/progress?bookId=... ; only the authenticated user's results. */
export interface ReviewProgressResponse {
  progress: ReviewProgressDTO[];
  attempts: ReviewAttemptDTO[];
}

export type ReviewApiErrorCode =
  | "invalid_request"
  | "unauthenticated"
  | "book_not_found"
  | "chapters_unavailable"
  | "source_changed"
  | "attempt_conflict"
  | "unsupported_source"
  | "generation_failed"
  | "grading_failed"
  | "unavailable";
export interface ReviewApiError {
  code: ReviewApiErrorCode;
  error: string;
}
