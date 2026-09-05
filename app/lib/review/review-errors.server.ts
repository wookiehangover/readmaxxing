import type { ReviewApiErrorCode } from "./review-types";

export const REVIEW_ERROR_STATUS: Record<ReviewApiErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  book_not_found: 404,
  chapters_unavailable: 409,
  source_changed: 409,
  attempt_conflict: 409,
  unsupported_source: 422,
  generation_failed: 502,
  grading_failed: 502,
  unavailable: 503,
};

export class ReviewApiFailure extends Error {
  constructor(
    public readonly code: ReviewApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}
