import { z } from "zod";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  ReviewAttemptConflictError,
  ReviewSourceMismatchError,
} from "~/lib/database/review/review-attempts.server";
import { ReviewApiFailure, REVIEW_ERROR_STATUS } from "./review-errors.server";
import type { ReviewApiError } from "./review-types";

const privateHeaders = { "Cache-Control": "private, no-store" };

/** All API successes and failures are private, including authenticated GET results. */
export async function reviewApi(
  request: Request,
  method: "GET" | "POST",
  run: (userId: string) => Promise<unknown>,
): Promise<Response> {
  if (request.method !== method) {
    return Response.json(
      { code: "invalid_request", error: "Method not allowed" } satisfies ReviewApiError,
      { status: 405, headers: { ...privateHeaders, Allow: method } },
    );
  }
  try {
    const session = await getSessionFromRequest(request);
    if (!session) throw new ReviewApiFailure("unauthenticated", "Sign in to use chapter reviews.");
    return Response.json(await run(session.userId), { headers: privateHeaders });
  } catch (error) {
    let failure: ReviewApiFailure;
    if (error instanceof ReviewApiFailure) failure = error;
    else if (error instanceof ReviewAttemptConflictError)
      failure = new ReviewApiFailure(
        "attempt_conflict",
        "This submission ID already belongs to a different answer. Use a new ID for an edited answer.",
      );
    else if (error instanceof ReviewSourceMismatchError)
      failure = new ReviewApiFailure(
        "source_changed",
        "The chapter or assigned question has changed. Reload the review; your draft can be kept.",
      );
    else
      failure = new ReviewApiFailure(
        "unavailable",
        "Chapter reviews are temporarily unavailable. Keep your answer and retry.",
      );
    return Response.json({ code: failure.code, error: failure.message } satisfies ReviewApiError, {
      status: REVIEW_ERROR_STATUS[failure.code],
      headers: privateHeaders,
    });
  }
}

const MAX_REQUEST_BYTES = 4_000_000;

/** Bound bytes before parsing and depth before recursive rich-text schema validation. */
export async function readReviewRequest<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  try {
    if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES || !request.body)
      throw new Error("Request too large or empty");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_REQUEST_BYTES) {
          await reader.cancel();
          throw new Error("Request too large");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const pending = [{ value, depth: 0 }];
    let count = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++count > 100_000 || item.depth > 64) throw new Error("Document too complex");
      if (item.value && typeof item.value === "object") {
        for (const child of Object.values(item.value))
          pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    return schema.parse(value);
  } catch {
    throw new ReviewApiFailure(
      "invalid_request",
      "Invalid review request. Submit the complete matching answer document and more than 30 trimmed text characters.",
    );
  }
}

export function reviewProgressBookId(request: Request): string {
  const params = new URL(request.url).searchParams;
  if (params.getAll("bookId").length !== 1 || [...params.keys()].some((key) => key !== "bookId")) {
    throw new ReviewApiFailure("invalid_request", "Exactly one bookId is required.");
  }
  const bookId = params.get("bookId");
  if (!bookId?.trim() || bookId.length > 200)
    throw new ReviewApiFailure("invalid_request", "A valid bookId is required.");
  return bookId;
}
