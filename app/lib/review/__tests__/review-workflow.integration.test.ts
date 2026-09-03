// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  TEXT,
  mocks,
  responses,
  chapters,
  replaceChapters,
  count,
  deferred,
  open,
  begin,
  edit,
  pass,
} from "./review-workflow-fixtures";
import { loadReviewCache } from "~/lib/review/review-cache";
import { reviewClient } from "~/lib/review/review-client";
import {
  setReviewGrading,
  setReviewsEnabled,
  startReviewCheckpoint,
  submitReviewAnswer,
  refreshReviewProgress,
  retryReviewQuestion,
} from "~/lib/themis/reviews/reviews-slice";
describe("review workflow with real client, routes, storage and ReactStore", () => {
  it("persists annotated nonpass, changed grading pass, and reload through the real transport contract", async () => {
    const store = await open();
    await begin(store);
    edit(store);
    mocks.generate.mockResolvedValueOnce({
      object: {
        verdict: "needs_work",
        issues: ["insufficient_evidence"],
        annotations: [{ start: 0, end: 3, quote: "The", issue: "insufficient_evidence" }],
      },
    });
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(
        store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-a")?.verdict,
      ).toBe("needs_work"),
    );
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
    expect(
      store.reviewsSelectors.selectLatestReviewAttempt.select(store.state, "book-a")?.annotations[0]
        .quote,
    ).toBe("The");
    edit(
      store,
      "Revised: The narrator changes her mind as new evidence challenges her assumptions.",
    );
    store.dispatch(setReviewGrading("book-a", "elite_professor"));
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
    );
    expect(await count("review_attempt")).toBe(2);
    store.dispose();
    const restored = await open();
    await vi.waitFor(() =>
      expect(
        restored.reviewsSelectors.selectReviewAttempts.select(restored.state, "book-a"),
      ).toHaveLength(2),
    );
    expect(restored.reviewsSelectors.selectReviewLocked.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(
      restored.reviewsSelectors.selectReviewCheckpoint.select(restored.state, "book-a")
        ?.returnLocator,
    ).toBe("return-cfi");
    expect(
      restored.reviewsSelectors.selectReviewAnswerText.select(restored.state, "book-a"),
    ).toContain("Revised:");
  });
  it("recovers an actual chapters_unavailable response once", async () => {
    await replaceChapters([{ index: 0, text: TEXT }]);
    mocks.reupload.mockImplementation(async () => replaceChapters(chapters()));
    const store = await open();
    await begin(store);
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
    expect(responses.filter((r) => r.url.endsWith("/question")).map((r) => r.status)).toEqual([
      409, 200,
    ]);
  });
  it("cannot restart a cancelled real-route request after legacy reupload resolves", async () => {
    await replaceChapters([{ index: 0, text: TEXT }]);
    const upload = deferred<void>();
    mocks.reupload.mockReturnValue(upload.promise);
    const store = await open();
    store.dispatch(setReviewsEnabled("book-a", true));
    store.dispatch(startReviewCheckpoint("book-a", 0, chapters()[0].reviewBoundaries[0], null));
    await vi.waitFor(() => expect(mocks.reupload).toHaveBeenCalledTimes(1));
    store.dispatch(setReviewsEnabled("book-a", false));
    await replaceChapters(chapters());
    upload.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(responses.filter((r) => r.url.endsWith("/question"))).toHaveLength(1);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(false);
  });
  it("invalidates cached pass when an authoritative progress refresh excludes replaced source", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters(chapters(`${TEXT} Completely new source.`));
    expect(await reviewClient.progress("book-a", new AbortController().signal)).toEqual({
      progress: [],
      attempts: [],
    });
    store.dispatch(refreshReviewProgress("book-a"));
    await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    const history = store.state.reviews.cache!.attempts;
    const draft = store.reviewsSelectors.selectReviewDocument.select(store.state, "book-a");
    store.dispose();
    vi.stubGlobal("navigator", { onLine: false });
    const restored = await open();
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(restored.reviewsSelectors.selectReviewDocument.select(restored.state, "book-a")).toEqual(
      draft,
    );
    expect(restored.state.reviews.cache?.attempts).toEqual(history);
    expect(
      restored.reviewsSelectors.selectReviewCheckpoint.select(restored.state, "book-a")
        ?.returnLocator,
    ).toBe("return-cfi");
    vi.stubGlobal("navigator", { onLine: true });
    window.dispatchEvent(new Event("online"));
    const previousQuestion = restored.reviewsSelectors.selectReviewQuestion.select(
      restored.state,
      "book-a",
    )!.id;
    restored.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(
        restored.reviewsSelectors.selectReviewQuestion.select(restored.state, "book-a")?.id,
      ).not.toBe(previousQuestion),
    );
    expect(
      restored.reviewsSelectors.selectReviewAssignmentCurrent.select(restored.state, "book-a"),
    ).toBe(true);
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      false,
    );
    expect(restored.state.reviews.cache?.drafts.ids).toHaveLength(1);
    expect(restored.state.reviews.cache?.attempts).toEqual(history);
  });
  it("does not carry a cached pass across an explicitly unsupported replacement source", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters(chapters("x".repeat(80_001)));
    store.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.question.error?.code).toBe("unsupported_source"),
    );
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  });
  it("retains source invalidation when repairing a legacy replacement upload fails", async () => {
    const store = await open();
    await begin(store);
    await pass(store);
    await replaceChapters([{ index: 0, text: TEXT }]);
    mocks.reupload.mockRejectedValueOnce(new Error("Local EPUB unavailable"));
    store.dispatch(retryReviewQuestion("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.question.error?.code).toBe("chapters_unavailable"),
    );
    expect(mocks.reupload).toHaveBeenCalledTimes(1);
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-a")).toHaveLength(
      1,
    );
    store.dispatch(setReviewsEnabled("book-a", false));
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(false);
  });
});

it("keeps an oversized draft reloadable after rejecting its submission", async () => {
  const store = await open();
  await begin(store);
  edit(store, "x".repeat(1_000_001));
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.state.reviews.requests.submit.error?.code).toBe("invalid_request"),
  );
  await loadReviewCache("00000000-0000-4000-8000-000000000001", "book-a");
  store.dispose();
  const restored = await open();
  expect(restored.state.reviews.localStatus).toBe("ready");
  expect(
    restored.reviewsSelectors.selectReviewAnswerText.select(restored.state, "book-a"),
  ).toHaveLength(1_000_001);
  await vi.waitFor(() => expect(restored.state.reviews.requests.question.token).toBeNull());
  edit(
    restored,
    "The repaired answer relates the narrator's changing perspective to the chapter's evidence.",
  );
  restored.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(restored.reviewsSelectors.selectReviewPassed.select(restored.state, "book-a")).toBe(
      true,
    ),
  );
});

it.each([false, true])(
  "keeps answer-only prompt limits retryable without revoking source authority (prior pass: %s)",
  async (previouslyPassed) => {
    const store = await open();
    await begin(store);
    if (previouslyPassed) await pass(store);
    const before = await reviewClient.progress("book-a", new AbortController().signal);
    const history = store.state.reviews.cache!.attempts;
    const questionRequests = responses.filter((response) =>
      response.url.endsWith("/question"),
    ).length;
    edit(store, "界".repeat(60_000));
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.requests.submit.error?.code).toBe("invalid_request"),
    );
    expect(store.state.reviews.requests.submit.error?.error).toContain("Shorten the answer");
    expect(responses.filter((response) => response.url.endsWith("/attempts")).at(-1)?.status).toBe(
      400,
    );
    expect(await reviewClient.progress("book-a", new AbortController().signal)).toEqual(before);
    expect(store.state.reviews.cache!.attempts).toBe(history);
    expect(store.reviewsSelectors.selectReviewAnswerText.select(store.state, "book-a")).toBe(
      "界".repeat(60_000),
    );
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(
      previouslyPassed,
    );
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(
      !previouslyPassed,
    );
    edit(store, "A corrected answer long enough to submit with chapter evidence.");
    expect(store.reviewsSelectors.selectReviewCanSubmit.select(store.state, "book-a")).toBe(true);
    store.dispatch(submitReviewAnswer("book-a"));
    await vi.waitFor(() =>
      expect(store.state.reviews.cache!.attempts.ids).toHaveLength(previouslyPassed ? 2 : 1),
    );
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true);
    expect(responses.filter((response) => response.url.endsWith("/question"))).toHaveLength(
      questionRequests,
    );
  },
);

it("invalidates a historical pass when submission detects an actually replaced oversized chapter", async () => {
  const store = await open();
  await begin(store);
  await pass(store);
  await replaceChapters(chapters("x".repeat(80_001)));
  edit(store, "A revised answer to the old chapter that cannot review its replacement.");
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.state.reviews.requests.submit.error?.code).toBe("source_changed"),
  );
  expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
  expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-a")).toHaveLength(1);
});
