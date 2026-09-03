import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import type { BookChapter } from "../../app/lib/epub/epub-text-extract";
import type {
  ReviewAttemptDTO,
  ReviewProgressDTO,
  ReviewQuestionResponse,
  ReviewSubmitRequest,
} from "../../app/lib/review/review-types";

export const questionText =
  "How does the narrator’s choice connect the chapter’s central conflict to its consequences? Support your interpretation with evidence from the chapter.";
export async function installReviewFixture(page: Page) {
  const fixture = {
    chapters: [] as BookChapter[],
    assignment: null as ReviewQuestionResponse | null,
    attempts: [] as ReviewAttemptDTO[],
    gradeCalls: 0,
    questionCalls: 0,
    progressCalls: 0,
    failConfirmation: false,
    failQuestion: false,
    authenticated: true,
    verdict: "needs_work" as ReviewAttemptDTO["verdict"],
  };
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: fixture.authenticated ? { id: "review-ui-user", displayName: "Review Reader" } : null,
      },
    }),
  );
  await page.route("**/api/sync/pull?*", (route) =>
    route.fulfill({ json: { changes: [], serverTimestamp: new Date().toISOString() } }),
  );
  await page.route("**/api/sync/push", (route) =>
    route.fulfill({
      json: {
        accepted: route
          .request()
          .postDataJSON()
          .changes.map((change: { id: string }) => ({ id: change.id })),
        rejected: [],
        serverTimestamp: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/api/sync/files/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "File sync unavailable in deterministic fixture" },
    }),
  );
  await page.route("**/api/books/*/chapters", (route) => {
    fixture.chapters = route.request().postDataJSON().chapters;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/reviews/question", async (route) => {
    fixture.questionCalls++;
    if (fixture.failQuestion)
      return route.fulfill({
        status: 503,
        json: {
          code: "generation_failed",
          error: "The question could not be generated. Try again.",
        },
      });
    const request = route.request().postDataJSON();
    const chapter = fixture.chapters.find((item) =>
      item.reviewBoundaries?.some((boundary) => boundary.key === request.chapterKey),
    );
    const boundary = chapter?.reviewBoundaries?.find((item) => item.key === request.chapterKey);
    if (!chapter || !boundary)
      return route.fulfill({
        status: 409,
        json: { code: "chapters_unavailable", error: "Upload chapter text first." },
      });
    const text = chapter.text
      .slice(boundary.startOffset, boundary.endOffset)
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim();
    const sourceFingerprint = `review-text-v1:${createHash("sha256").update(text).digest("hex")}`;
    const progress: ReviewProgressDTO = {
      userId: "review-ui-user",
      bookId: request.bookId,
      chapterKey: boundary.key,
      sourceFingerprint,
      questionId: "fixture-question",
      latestAttemptId: null,
      passedAttemptId: null,
      updatedAt: Date.now(),
    };
    fixture.assignment = {
      chapter: {
        bookId: request.bookId,
        chapterKey: boundary.key,
        sourceFingerprint,
        chapterIndex: chapter.index,
        boundary,
      },
      question: {
        id: "fixture-question",
        sourceFingerprint,
        difficulty: request.difficulty,
        generationVersion: "chapter-review-v1",
        question: questionText,
        createdAt: Date.now(),
      },
      progress,
    };
    return route.fulfill({ json: fixture.assignment });
  });
  await page.route("**/api/reviews/attempts", async (route) => {
    fixture.gradeCalls++;
    const request = route.request().postDataJSON() as ReviewSubmitRequest;
    const start = request.plainText.indexOf("claim");
    const attempt: ReviewAttemptDTO = {
      ...request,
      sourceFingerprint: fixture.assignment!.chapter.sourceFingerprint,
      userId: "review-ui-user",
      verdict: fixture.verdict,
      feedback:
        fixture.verdict === "pass"
          ? "Your reasoning is supported by the chapter evidence."
          : "Your claim needs a clearer connection to specific evidence. Explain how your evidence supports it.",
      annotations:
        start < 0
          ? []
          : [
              {
                start,
                end: start + 5,
                quote: "claim",
                feedback: "Explain which evidence supports this claim.",
              },
            ],
      createdAt: Date.now(),
    };
    fixture.attempts.push(attempt);
    fixture.assignment!.progress = {
      ...fixture.assignment!.progress,
      latestAttemptId: attempt.id,
      passedAttemptId: fixture.verdict === "pass" ? attempt.id : null,
      updatedAt: attempt.createdAt,
    };
    return route.fulfill({ json: { attempt, progress: fixture.assignment!.progress } });
  });
  await page.route("**/api/reviews/progress?*", (route) => {
    fixture.progressCalls++;
    if (fixture.failConfirmation)
      return route.fulfill({
        status: 503,
        json: { code: "unavailable", error: "Progress confirmation is unavailable." },
      });
    return route.fulfill({
      json: {
        progress: fixture.assignment ? [fixture.assignment.progress] : [],
        attempts: fixture.attempts,
      },
    });
  });
  return fixture;
}

export async function openReviewBook(page: Page, file = resolve("e2e/fixtures/test-book.epub")) {
  await page.goto("/library");
  await page.locator('input[type="file"][accept=".epub,.pdf"]').first().setInputFiles(file);
  // Uploading opens the workspace automatically; wait for that transition to finish.
  await expect(page.getByRole("button", { name: "Reader menu", exact: true })).toBeVisible();
  await openReviewSettings(page);
}
export async function openReviewSettings(page: Page) {
  await page.getByRole("button", { name: "Reader menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Review", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).toBeVisible();
}
export async function reachReview(page: Page, mobile: boolean, questionReady = true) {
  const target = questionReady
    ? page.getByTestId("review-question")
    : page.getByRole("button", { name: "Retry question", exact: true }).first();
  if (mobile) await page.getByRole("tab", { name: "Read", exact: true }).click();
  for (let i = 0; i < 12 && !(await target.isVisible()); i++) {
    // The real EPUB keyboard path handles the chapter endpoint on both screen sizes.
    const frame = page.locator('[aria-label="Book surface"] iframe').first();
    // The question can replace the chapter between the loop check and iframe readiness.
    await expect
      .poll(async () => (await target.isVisible()) || (await frame.isVisible()))
      .toBe(true);
    if (await target.isVisible()) break;
    await frame.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () =>
          (await target.isVisible()) ||
          (await page.getByText("Preparing your chapter question…").count()) > 0,
        { timeout: 800 },
      )
      .toBe(true)
      .catch(() => {});
  }
  await expect(target).toBeVisible();
}
