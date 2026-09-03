import type {
  ReviewApiError,
  ReviewApiErrorCode,
  ReviewProgressResponse,
  ReviewQuestionRequest,
  ReviewQuestionResponse,
  ReviewSubmitRequest,
  ReviewSubmitResponse,
} from "./review-types";

const errorCodes: readonly ReviewApiErrorCode[] = [
  "invalid_request",
  "unauthenticated",
  "book_not_found",
  "chapters_unavailable",
  "source_changed",
  "attempt_conflict",
  "unsupported_source",
  "generation_failed",
  "grading_failed",
  "unavailable",
];

export class ReviewClientError extends Error {
  constructor(
    public readonly detail: ReviewApiError,
    public readonly status = 0,
  ) {
    super(detail.error);
    this.name = "ReviewClientError";
  }
}

export function reviewClientError(cause: unknown): ReviewApiError {
  return cause instanceof ReviewClientError
    ? cause.detail
    : {
        code: "unavailable",
        error: cause instanceof Error ? cause.message : "Review request failed. Please retry.",
      };
}

async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = errorCodes.includes(data?.code)
      ? (data.code as ReviewApiErrorCode)
      : response.status === 401
        ? "unauthenticated"
        : "unavailable";
    throw new ReviewClientError(
      {
        code,
        error:
          typeof data?.error === "string" ? data.error : "Review request failed. Please retry.",
      },
      response.status,
    );
  }
  if (data === null)
    throw new ReviewClientError({
      code: "unavailable",
      error: "Invalid review response. Please retry.",
    });
  return data as T;
}

export const reviewClient = {
  question: (body: ReviewQuestionRequest, signal: AbortSignal) =>
    request<ReviewQuestionResponse>("/api/reviews/question", signal, body),
  submit: (body: ReviewSubmitRequest, signal: AbortSignal) =>
    request<ReviewSubmitResponse>("/api/reviews/attempts", signal, body),
  progress: (bookId: string, signal: AbortSignal) =>
    request<ReviewProgressResponse>(
      `/api/reviews/progress?bookId=${encodeURIComponent(bookId)}`,
      signal,
    ),
};
