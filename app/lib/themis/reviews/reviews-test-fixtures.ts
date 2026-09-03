import type {
  ReviewChapterBoundary,
  ReviewQuestionResponse,
  ReviewRichTextNode,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
  ReviewVerdict,
} from "~/lib/review/review-types";

export const fingerprint = `review-text-v1:${"a".repeat(64)}`;
export const boundary: ReviewChapterBoundary = {
  key: "review-v1:0:0",
  title: "Chapter one",
  start: { spineIndex: 0, href: "chapter.xhtml", fragment: null, textOffset: 0 },
  end: { spineIndex: 1, href: "second.xhtml", fragment: null, textOffset: 0 },
  startOffset: 0,
  endOffset: 100,
};

export function document(
  text = "A thoughtful answer with more than thirty characters.",
): ReviewRichTextNode {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

export function questionResponse(
  bookId = "book-1",
  userId = "user-1",
  chapterBoundary = boundary,
): ReviewQuestionResponse {
  return {
    chapter: {
      bookId,
      chapterKey: chapterBoundary.key,
      sourceFingerprint: fingerprint,
      chapterIndex: chapterBoundary.start.spineIndex,
      boundary: chapterBoundary,
    },
    question: {
      id: `question-${chapterBoundary.key}`,
      sourceFingerprint: fingerprint,
      difficulty: "friendly",
      generationVersion: "chapter-review-v1",
      question: "How do the chapter's arguments connect?",
      createdAt: 1,
    },
    progress: {
      userId,
      bookId,
      chapterKey: chapterBoundary.key,
      sourceFingerprint: fingerprint,
      questionId: `question-${chapterBoundary.key}`,
      latestAttemptId: null,
      passedAttemptId: null,
      updatedAt: 1,
    },
  };
}

export function submitResponse(
  request: ReviewSubmitRequest,
  verdict: ReviewVerdict = "pass",
  createdAt = 2,
): ReviewSubmitResponse {
  return {
    attempt: {
      ...request,
      userId: "user-1",
      sourceFingerprint: fingerprint,
      verdict,
      feedback: "Consider how the claims connect.",
      annotations: [],
      createdAt,
    },
    progress: {
      ...questionResponse().progress,
      chapterKey: request.chapterKey,
      questionId: request.questionId,
      latestAttemptId: request.id,
      passedAttemptId: verdict === "pass" ? request.id : null,
      updatedAt: createdAt,
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
