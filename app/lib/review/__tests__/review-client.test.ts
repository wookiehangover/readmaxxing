import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewClient, ReviewClientError, reviewClientError } from "../review-client";
import { document, questionResponse } from "~/lib/themis/reviews/reviews-test-fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("review client contracts", () => {
  it("uses the agreed routes, credentials, encoded book id and caller cancellation", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(questionResponse())));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const request = {
      bookId: "book/a?b",
      chapterKey: "review-v1:0:0",
      difficulty: "friendly" as const,
    };
    await reviewClient.question(request, controller.signal);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/reviews/question",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify(request),
      }),
    );
    await reviewClient.progress(request.bookId, controller.signal);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/reviews/progress?bookId=book%2Fa%3Fb",
      expect.objectContaining({ method: "GET", signal: controller.signal }),
    );
    const submission = {
      id: "same-retry-id",
      bookId: "book-1",
      chapterKey: request.chapterKey,
      questionId: "q",
      document: document(),
      plainText: "A thoughtful answer with more than thirty characters.",
      grading: "reading_group" as const,
    };
    await reviewClient.submit(submission, controller.signal);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/reviews/attempts",
      expect.objectContaining({ body: JSON.stringify(submission) }),
    );
  });
  it.each([
    [400, "invalid_request"],
    [401, "unauthenticated"],
    [404, "book_not_found"],
    [409, "chapters_unavailable"],
    [409, "source_changed"],
    [409, "attempt_conflict"],
    [422, "unsupported_source"],
    [502, "generation_failed"],
    [502, "grading_failed"],
    [503, "unavailable"],
  ])("preserves recoverable API errors (%s / %s)", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code, error: "Explanation" }), { status }),
        ),
    );
    const failure = await reviewClient
      .progress("book", new AbortController().signal)
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ReviewClientError);
    expect(reviewClientError(failure)).toEqual({ code, error: "Explanation" });
  });
  it("normalizes non-JSON proxy failures without inventing a success result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("gateway down", { status: 503 })),
    );
    await expect(reviewClient.progress("book", new AbortController().signal)).rejects.toMatchObject(
      { detail: { code: "unavailable" } },
    );
  });
});
