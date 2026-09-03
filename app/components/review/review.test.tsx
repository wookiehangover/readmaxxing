import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppStore, type AppStore } from "~/lib/themis/store";
import { authSessionResolved } from "~/lib/themis/auth-session/auth-session-slice";
import { emptyReviewCache } from "~/lib/themis/reviews/reviews-records";
import {
  boundary,
  document as answerDocument,
  questionResponse,
  submitResponse,
} from "~/lib/themis/reviews/reviews-test-fixtures";
import {
  backtrackReview,
  editReviewDraft,
  openReviewBook,
  refreshReviewProgress,
  reviewCacheLoaded,
  reviewCacheLoadFailed,
  retryReviewPersistence,
  reviewCheckpointEntered,
  reviewConnectivityChanged,
  reviewPersistenceFailed,
  reviewProgressReceived,
  reviewQuestionReceived,
  reviewRequestFailed,
  reviewRequestStarted,
  setReviewsEnabled,
  showReview,
  submitReviewAnswer,
} from "~/lib/themis/reviews/reviews-slice";
import { ReadingRailProvider } from "~/components/reading-shell/reading-rail-context";
import { ReviewPanel } from "./review-panel";
import { ReviewPage } from "./review-page";
import { ReviewFeedback } from "./review-feedback";

vi.mock("~/lib/themis/provider", () => ({ useAppStore: () => store }));
let store: AppStore;
let root: Root;
let container: HTMLDivElement;
const navigation = {
  current: { backToChapter: vi.fn(), continueReading: vi.fn(), showQuestion: vi.fn() },
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function update(fn: () => void) {
  await act(async () => {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
function render(children: React.ReactNode) {
  act(() =>
    root.render(
      <MemoryRouter>
        <ReadingRailProvider scope="book-1" privateBookId="book-1">
          {children}
        </ReadingRailProvider>
      </MemoryRouter>,
    ),
  );
}
function assign() {
  store.dispatch(setReviewsEnabled("book-1", true));
  store.dispatch(reviewCheckpointEntered("book-1", 0, boundary, "saved"));
  const generation = store.state.reviews.generation;
  store.dispatch(reviewRequestStarted(generation, "question", "q"));
  store.dispatch(reviewQuestionReceived(generation, "q", questionResponse()));
  store.dispatch(reviewRequestStarted(generation, "progress", "p"));
  store.dispatch(
    reviewProgressReceived(generation, "p", {
      progress: [questionResponse().progress],
      attempts: [],
    }),
  );
}
function draft(text: string) {
  const assignment = store.reviewsSelectors.selectReviewAssignment.select(store.state, "book-1")!;
  store.dispatch(editReviewDraft("book-1", assignment.id, answerDocument(text), Date.now()));
}
const buttons = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => button.textContent?.trim() === label,
  );

beforeEach(() => {
  store = createAppStore();
  store.init();
  store.dispatch(authSessionResolved({ id: "user-1", displayName: null }));
  store.dispatch(openReviewBook("book-1"));
  store.dispatch(
    reviewCacheLoaded(store.state.reviews.generation, emptyReviewCache("user-1", "book-1")),
  );
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  navigation.current.backToChapter
    .mockReset()
    .mockImplementation(async () => store.dispatch(backtrackReview("book-1")));
  navigation.current.continueReading.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  store.dispose();
  container.remove();
});

describe("Review UI with canonical Redux and real TipTap", () => {
  it("defaults off and exposes the approved settings labels after enabling", async () => {
    render(<ReviewPanel bookId="book-1" />);
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(container.textContent).toContain("Pause at the end");
    await update(() => toggle.click());
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(container.textContent).toContain("Friendly");
    expect(container.textContent).toContain("Reading Group");
    expect(
      store.reviewsSelectors.selectReviewPreferences.select(store.state, "book-1").enabled,
    ).toBe(true);
  });
  it("uses exactly 20px book typography and the shared Unicode threshold", async () => {
    assign();
    draft("😀".repeat(30));
    render(<ReviewPage bookId="book-1" fontFamily="Lora" navigation={navigation} />);
    const question = container.querySelector<HTMLElement>('[data-testid="review-question"]')!;
    expect(question.style.fontSize).toBe("20px");
    expect(question.style.fontFamily).toContain("Lora");
    expect(container.querySelector("[data-review-editor]")).not.toBeNull();
    expect(
      container.querySelector('[data-testid="review-answer"]')?.classList.contains("font-sans"),
    ).toBe(true);
    expect(container.querySelector('[role="textbox"][aria-label="Your answer"]')).not.toBeNull();
    expect(buttons("Submit answer")).toHaveLength(0);
    await update(() => draft("  " + "😀".repeat(31) + "  "));
    expect(buttons("Submit answer")).toHaveLength(1);
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, "dispatch", { configurable: true, value: dispatch });
    await update(() => buttons("Submit answer")[0].click());
    expect(dispatch).toHaveBeenCalledWith(submitReviewAnswer("book-1"));
    await update(() =>
      store.dispatch(reviewRequestStarted(store.state.reviews.generation, "submit", "grading")),
    );
    expect(buttons("Grading…")[0].disabled).toBe(true);
  });
  it("backtracks through the existing navigation control and retains the answer", async () => {
    assign();
    draft("My answer remains available when I reread this chapter.");
    render(
      <>
        <ReviewPage bookId="book-1" fontFamily="Literata" navigation={navigation} />
        <ReviewPanel bookId="book-1" />
      </>,
    );
    await update(() => buttons("Back to chapter")[0].click());
    expect(navigation.current.backToChapter).toHaveBeenCalledOnce();
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(true);
    expect(store.reviewsSelectors.selectReviewVisible.select(store.state, "book-1")).toBe(false);
    await update(() => buttons(questionResponse().question.question)[0].click());
    expect(store.reviewsSelectors.selectReviewVisible.select(store.state, "book-1")).toBe(true);
    expect(store.reviewsSelectors.selectReviewAnswerText.select(store.state, "book-1")).toContain(
      "My answer remains",
    );
  });
  it("keeps disable and editing available offline and after a local save failure", async () => {
    assign();
    store.dispatch(reviewConnectivityChanged(false));
    store.dispatch(reviewPersistenceFailed(store.state.reviews.generation, "Storage is full."));
    render(
      <>
        <ReviewPanel bookId="book-1" />
        <ReviewPage bookId="book-1" fontFamily="Literata" navigation={navigation} />
      </>,
    );
    expect(container.textContent).toContain("You’re offline");
    expect(container.textContent).toContain("Storage is full.");
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.hasAttribute("data-disabled")).toBe(false);
    await update(() => toggle.click());
    expect(store.reviewsSelectors.selectReviewLocked.select(store.state, "book-1")).toBe(false);
  });
  it("keeps the settings surface through loading, load failure and sign-out", async () => {
    store.dispatch(openReviewBook("book-2"));
    render(<ReviewPanel bookId="book-2" />);
    expect(container.textContent).toContain("Loading your review settings");
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
    await update(() =>
      store.dispatch(
        reviewCacheLoadFailed(store.state.reviews.generation, "Saved reviews unavailable."),
      ),
    );
    expect(container.textContent).toContain("Saved reviews unavailable");
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, "dispatch", { configurable: true, value: dispatch });
    await update(() => buttons("Retry saving or loading")[0].click());
    expect(dispatch).toHaveBeenCalledWith(retryReviewPersistence("book-2"));
    await update(() => store.dispatch(authSessionResolved(null)));
    expect(container.textContent).toContain("Sign in to generate and grade reviews");
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });
  it("retries progress confirmation without a second grade or question request", async () => {
    assign();
    draft("An existing thoughtful answer for source confirmation.");
    const generation = store.state.reviews.generation;
    // Successful progress excluding the assignment leaves the historical draft.
    store.dispatch(reviewRequestStarted(generation, "progress", "changed"));
    store.dispatch(reviewProgressReceived(generation, "changed", { progress: [], attempts: [] }));
    store.dispatch(reviewRequestStarted(generation, "progress", "retry"));
    store.dispatch(
      reviewRequestFailed(generation, "progress", "retry", {
        code: "unavailable",
        error: "Confirmation unavailable.",
      }),
    );
    render(<ReviewPanel bookId="book-1" />);
    expect(buttons("Retry question")).toHaveLength(0);
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, "dispatch", { configurable: true, value: dispatch });
    await update(() => buttons("Retry confirmation")[0].click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      refreshReviewProgress("book-1"),
    ]);
  });
  it("offers source retry only after a completed confirmation excludes the assignment", async () => {
    assign();
    const generation = store.state.reviews.generation;
    store.dispatch(reviewRequestStarted(generation, "progress", "changed"));
    store.dispatch(reviewProgressReceived(generation, "changed", { progress: [], attempts: [] }));
    render(<ReviewPanel bookId="book-1" />);
    expect(buttons("Retry question")).toHaveLength(1);
    await update(() => store.dispatch(reviewRequestStarted(generation, "progress", "pending")));
    expect(buttons("Retry question")).toHaveLength(0);
    expect(container.textContent).toContain("Confirming this review");
  });
  it("annotates the immutable submitted snapshot with UTF-16 offsets and rejects mismatched quotes", () => {
    const text = "😀 A submitted claim that needs more support.";
    const attempt = submitResponse(
      {
        id: "a",
        bookId: "book-1",
        chapterKey: boundary.key,
        questionId: "q",
        grading: "elite_professor",
        document: answerDocument(text),
        plainText: text,
      },
      "needs_work",
    ).attempt;
    attempt.annotations = [
      {
        start: 5,
        end: 14,
        quote: "submitted",
        feedback: "Explain the connection to your evidence.",
      },
      { start: 0, end: 2, quote: "wrong", feedback: "Must not appear." },
    ];
    render(<ReviewFeedback attempt={attempt} />);
    expect(container.querySelector("mark")?.textContent).toBe("submitted");
    expect(container.textContent).toContain("Elite Professor");
    expect(container.textContent).not.toContain("Must not appear");
    expect(container.textContent).not.toContain("Model answer");
  });
  it("passes render through the existing onward control", async () => {
    assign();
    const text = "A supported argument that connects the chapter evidence.";
    const response = submitResponse({
      id: "a",
      bookId: "book-1",
      chapterKey: boundary.key,
      questionId: questionResponse().question.id,
      grading: "reading_group",
      document: answerDocument(text),
      plainText: text,
    });
    const generation = store.state.reviews.generation;
    store.dispatch(reviewRequestStarted(generation, "progress", "pass"));
    store.dispatch(
      reviewProgressReceived(generation, "pass", {
        progress: [response.progress],
        attempts: [response.attempt],
      }),
    );
    store.dispatch(showReview("book-1"));
    render(<ReviewPage bookId="book-1" fontFamily="Literata" navigation={navigation} />);
    await update(() => buttons("Continue reading")[0].click());
    expect(navigation.current.continueReading).toHaveBeenCalledOnce();
  });
});
