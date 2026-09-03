// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  TEXT,
  begin,
  chapters,
  count,
  edit,
  holdNextResponse,
  open,
  pass,
  replaceChapters,
  responses,
} from "./review-workflow-fixtures";
import {
  refreshReviewProgress,
  retryReviewQuestion,
  setReviewGrading,
  submitReviewAnswer,
} from "~/lib/themis/reviews/reviews-slice";

it.each(["attempts", "question"] as const)(
  "rechecks source after an old %s response arrives before a newer source-invalidating snapshot",
  async (operation) => {
    const store = await open();
    await begin(store);
    if (operation === "question") await pass(store);
    edit(store, "This answer must survive source replacement and reversed HTTP delivery.");
    const mutation = holdNextResponse(operation);
    store.dispatch(
      operation === "attempts" ? submitReviewAnswer("book-a") : retryReviewQuestion("book-a"),
    );
    expect((await mutation.processed).status).toBe(200);
    expect(await count("review_attempt")).toBe(1);
    await replaceChapters(chapters(`${TEXT} Changed after mutation committed.`));
    const newerSnapshot = holdNextResponse("progress");
    store.dispatch(refreshReviewProgress("book-a"));
    const newer = await newerSnapshot.processed;
    expect(newer.data).toEqual({ progress: [], attempts: [] });
    const progressCount = responses.filter((response) => response.url.includes("/progress")).length;
    const confirmation = holdNextResponse("progress");
    mutation.release();
    expect((await confirmation.processed).data).toEqual({ progress: [], attempts: [] });
    // Never release navigation while the newer source authority is unresolved.
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
    expect(newer.signal?.aborted).toBe(true);
    newerSnapshot.release();
    confirmation.release();
    await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
    expect(store.reviewsSelectors.selectReviewAnswerText.select(store.state, "book-a")).toContain(
      "survive source replacement",
    );
    expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-a")).toHaveLength(
      1,
    );
    expect(responses.filter((response) => response.url.includes("/progress"))).toHaveLength(
      progressCount + 1,
    );
  },
);

it("retains a newer source invalidation delivered before the older committed grade", async () => {
  const store = await open();
  await begin(store);
  edit(store);
  const grade = holdNextResponse("attempts");
  store.dispatch(submitReviewAnswer("book-a"));
  const completed = await grade.processed;
  await replaceChapters(chapters(`${TEXT} Replaced before delivery.`));
  store.dispatch(refreshReviewProgress("book-a"));
  await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
  expect(completed.signal?.aborted).toBe(true);
  grade.release();
  await Promise.resolve();
  expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
  expect(await count("review_attempt")).toBe(1);
});

it("confirms a new assignment without applying an older pre-assignment empty snapshot", async () => {
  const store = await open();
  await begin(store);
  await pass(store);
  const oldQuestion = store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-a")!.id;
  await replaceChapters(chapters(`${TEXT} Replaced before the question was assigned.`));
  const oldSnapshot = holdNextResponse("progress");
  store.dispatch(refreshReviewProgress("book-a"));
  const old = await oldSnapshot.processed;
  expect(old.data).toEqual({ progress: [], attempts: [] });
  const question = holdNextResponse("question");
  store.dispatch(retryReviewQuestion("book-a"));
  expect((await question.processed).status).toBe(200);
  expect(old.signal?.aborted).toBe(true);
  const confirmation = holdNextResponse("progress");
  question.release();
  await confirmation.processed;
  expect(store.reviewsSelectors.selectReviewAssignmentCurrent.select(store.state, "book-a")).toBe(
    false,
  );
  oldSnapshot.release();
  confirmation.release();
  await vi.waitFor(() => expect(store.state.reviews.requests.progress.token).toBeNull());
  expect(store.reviewsSelectors.selectReviewQuestion.select(store.state, "book-a")!.id).not.toBe(
    oldQuestion,
  );
  expect(store.reviewsSelectors.selectReviewAssignmentCurrent.select(store.state, "book-a")).toBe(
    true,
  );
  expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  await pass(store);
  expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(false);
});

it("keeps confirmation of a completed grade alive while editing the next draft and grading preference", async () => {
  const store = await open();
  await begin(store);
  edit(store);
  const confirmation = holdNextResponse("progress");
  store.dispatch(submitReviewAnswer("book-a"));
  const processed = await confirmation.processed;
  expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-a")).toBe(true);
  edit(store, "The next draft stays editable while the completed attempt is confirmed.");
  store.dispatch(setReviewGrading("book-a", "elite_professor"));
  expect(processed.signal?.aborted).toBe(false);
  confirmation.release();
  await vi.waitFor(() =>
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
  );
  expect(store.reviewsSelectors.selectReviewAnswerText.select(store.state, "book-a")).toContain(
    "next draft stays editable",
  );
});

it("retains an unconfirmed completed grade through a failed confirmation and retries only the read", async () => {
  const store = await open();
  await begin(store);
  edit(store);
  const fetch = globalThis.fetch;
  let failConfirmation = true;
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/progress") && failConfirmation) {
      failConfirmation = false;
      throw new Error("Confirmation temporarily unavailable");
    }
    return fetch(url, init);
  });
  vi.stubGlobal("fetch", transport);
  store.dispatch(submitReviewAnswer("book-a"));
  await vi.waitFor(() =>
    expect(store.state.reviews.requests.progress.error?.code).toBe("unavailable"),
  );
  expect(store.reviewsSelectors.selectReviewAttempts.select(store.state, "book-a")).toHaveLength(1);
  expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(false);
  expect(transport.mock.calls.filter(([url]) => url.includes("/progress"))).toHaveLength(1);
  store.dispatch(refreshReviewProgress("book-a"));
  await vi.waitFor(() =>
    expect(store.reviewsSelectors.selectReviewPassed.select(store.state, "book-a")).toBe(true),
  );
  expect(transport.mock.calls.filter(([url]) => url.includes("/attempts"))).toHaveLength(1);
  expect(await count("review_attempt")).toBe(1);
});
