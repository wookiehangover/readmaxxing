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

export interface ReviewChapterPoint {
  spineIndex: number;
  href: string;
  fragment: string | null;
  textOffset: number;
}
export interface ReviewChapterBoundary {
  key: string;
  title: string;
  start: ReviewChapterPoint;
  end: ReviewChapterPoint | null;
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
export interface ReviewDraft extends ReviewChapterRef, ReviewAnswerSnapshot {
  userId: string;
  questionId: string;
  updatedAt: number;
}

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
