// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, expect as browserExpect, type Browser, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { reviewHttpFixture, model, sessions, users } from "./review-http-fixture";
import { openReviewBook, openReviewSettings, reachReview } from "../../../../e2e/helpers/review";
import type { ReviewQuestionResponse } from "../review-types";

// Opt in against a stable production preview; all API data is isolated in a fresh PGlite instance.
const enabled = Boolean(process.env.REVIEW_BROWSER_URL);
let fixture: Awaited<ReturnType<typeof reviewHttpFixture>>;
let browser: Browser;
beforeAll(async () => {
  if (!enabled) return;
  fixture = await reviewHttpFixture();
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => {
  await browser?.close();
  await fixture?.close();
});

it.skipIf(!enabled)(
  "native reader uses authenticated HTTP/SQL reuse, private drafts and immutable grades across accounts",
  async () => {
    async function reader(userIndex: number, mobile = false, file?: string) {
      const context = await browser.newContext({
        baseURL: process.env.REVIEW_BROWSER_URL,
        serviceWorkers: "block",
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
        hasTouch: mobile,
      });
      const page = await context.newPage();
      await fixture.attach(page, userIndex);
      await openReviewBook(page, file);
      return page;
    }
    async function checkpoint(page: Page, mobile = false, difficulty = "Friendly") {
      await page.getByRole("switch", { name: "Chapter reviews" }).click();
      if (difficulty !== "Friendly") {
        await page.getByRole("combobox", { name: "Difficulty" }).click();
        await page.getByRole("option", { name: difficulty, exact: true }).click();
      }
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/api/reviews/question") && r.status() === 200,
      );
      await reachReview(page, mobile);
      const result = await response;
      expect(result.headers()["cache-control"]).toBe("private, no-store");
      const data = (await result.json()) as ReviewQuestionResponse;
      expect(JSON.stringify(data)).not.toMatch(/PRIVATE RUBRIC|passingGuidance|provenance/);
      return data;
    }
    const alice = await reader(0);
    const first = await checkpoint(alice);
    const draft = "Weak private claim from Alice without enough chapter support to establish it.";
    const answer = alice.getByRole("textbox", { name: "Your answer" });
    await answer.fill(draft);
    await alice.getByRole("button", { name: "Submit answer", exact: true }).click();
    await browserExpect(alice.getByRole("heading", { name: "Not yet" })).toBeVisible();
    await browserExpect(alice.getByRole("blockquote").locator("mark")).toHaveText("Weak");
    await answer.fill(
      "Partial private claim with some relevant evidence but incomplete reasoning.",
    );
    await alice.getByRole("button", { name: "Submit answer", exact: true }).click();
    await browserExpect(alice.getByRole("heading", { name: "Needs work" })).toBeVisible();
    await alice.reload();
    await browserExpect(answer).toContainText("Partial private claim");

    const repackaged = unzipSync(await readFile("e2e/fixtures/test-book.epub"));
    const chapterPath = "OEBPS/chapter1.xhtml";
    repackaged[chapterPath] = strToU8(
      strFromU8(repackaged[chapterPath]).replace("first chapter", "first\u00a0 \nchapter"),
    );
    const repackagedPath = ".intent/artifacts/final-whitespace.epub";
    await writeFile(repackagedPath, zipSync(repackaged));
    const bob = await reader(1, true, resolve(repackagedPath));
    const second = await checkpoint(bob, true);
    expect(second.chapter.bookId).not.toBe(first.chapter.bookId);
    expect(second.question.id).toBe(first.question.id);
    expect(second.question.sourceFingerprint).toBe(first.question.sourceFingerprint);
    const storedSources = await fixture.db.query<{ text: string }>(
      "SELECT chapters->0->>'text' AS text FROM readmax.book_chapters WHERE book_id IN ($1,$2)",
      [first.chapter.bookId, second.chapter.bookId],
    );
    expect(storedSources.rows).toHaveLength(2);
    expect(storedSources.rows[0].text).not.toBe(storedSources.rows[1].text);
    await browserExpect(bob.getByRole("textbox", { name: "Your answer" })).toBeEmpty();
    await browserExpect(bob.getByRole("region", { name: "Review feedback" })).toHaveCount(0);
    expect(
      model.generate.mock.calls.filter(([call]) => call.schemaName === "chapter_review_question"),
    ).toHaveLength(1);
    const privateResponse = await bob.evaluate(async (bookId) => {
      const response = await fetch(`/api/reviews/progress?bookId=${bookId}`);
      return { status: response.status, body: await response.json() };
    }, first.chapter.bookId);
    expect(privateResponse.status).toBe(404);
    expect(JSON.stringify(privateResponse.body)).not.toContain("private claim");

    await openReviewSettings(alice);
    await alice.getByRole("combobox", { name: "Difficulty" }).click();
    await alice.getByRole("option", { name: "Tyler Cowen", exact: true }).click();
    await alice.getByRole("combobox", { name: "Grading" }).click();
    await alice.getByRole("option", { name: "Elite Professor", exact: true }).click();
    await browserExpect(alice.getByRole("region", { name: "Review feedback" })).toContainText(
      "Reading Group",
    );
    await answer.fill(
      "Strong private claim supported by two accurate details and explained reasoning.",
    );
    await alice.getByRole("button", { name: "Submit answer", exact: true }).click();
    await browserExpect(alice.getByRole("button", { name: "Continue reading" })).toBeVisible();
    await alice.screenshot({ path: ".intent/artifacts/final-http-desktop-pass.png" });
    const rows = await fixture.db.query<{ grading: string; verdict: string; user_id: string }>(
      "SELECT grading,verdict,user_id FROM readmax.review_attempt ORDER BY created_at",
    );
    expect(rows.rows.map(({ grading, verdict }) => [grading, verdict])).toEqual([
      ["reading_group", "fail"],
      ["reading_group", "needs_work"],
      ["elite_professor", "pass"],
    ]);
    expect(rows.rows.every((row) => row.user_id === users[0])).toBe(true);
    await alice.reload();
    await browserExpect(alice.getByRole("button", { name: "Continue reading" })).toBeVisible();
    await browserExpect(alice.getByRole("combobox", { name: "Difficulty" })).toContainText(
      "Tyler Cowen",
    );
    await browserExpect(alice.getByRole("combobox", { name: "Grading" })).toContainText(
      "Elite Professor",
    );
    const finalQuestion = alice.waitForResponse(
      (r) => r.url().endsWith("/api/reviews/question") && r.status() === 200,
    );
    await alice.getByRole("button", { name: "Continue reading" }).click();
    await browserExpect(alice.getByTestId("review-question")).toHaveCount(0);
    await reachReview(alice, false);
    const final = (await (await finalQuestion).json()) as ReviewQuestionResponse;
    expect(final.chapter.chapterKey).not.toBe(first.chapter.chapterKey);
    expect(final.question.difficulty).toBe("tyler_cowen");
    expect(final.chapter.boundary.end).toBeNull();
    await alice.getByRole("button", { name: "Back to chapter" }).click();
    await browserExpect(alice.locator('[aria-label="Book surface"] iframe').first()).toBeVisible();
    await alice.getByRole("button", { name: final.question.question, exact: true }).click();
    await browserExpect(answer).toBeEmpty();

    const bobAnswer = bob.getByRole("textbox", { name: "Your answer" });
    await bobAnswer.fill(
      "Bob's private draft remains separate from Alice's private answer history.",
    );
    await bob.screenshot({ path: ".intent/artifacts/final-http-mobile-private.png" });
    await bob.reload();
    await bob.getByRole("tab", { name: "Read", exact: true }).click();
    await browserExpect(bobAnswer).toContainText("Bob's private draft");
    await fixture.db.query("DELETE FROM readmax.session WHERE id=$1", [sessions[1]]);
    await bob.getByRole("button", { name: "Submit answer", exact: true }).click();
    await browserExpect(bob.getByText("Sign in to use chapter reviews.").first()).toBeVisible();
    await browserExpect(bobAnswer).toContainText("Bob's private draft");
    await openReviewSettings(bob);
    await bob.getByRole("switch", { name: "Chapter reviews" }).click();
    await browserExpect(bob.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();

    // A new upload at another difficulty cannot inherit the prior question or pass.
    const other = await reader(0);
    const harder = await checkpoint(other, false, "Challenging");
    expect(harder.question.id).not.toBe(first.question.id);
    expect(harder.question.sourceFingerprint).toBe(first.question.sourceFingerprint);
    await browserExpect(other.getByRole("textbox", { name: "Your answer" })).toBeEmpty();
    // PDF exclusion is already covered by UI unit tests; verify it on this actual reader too.
    await other.goto("/library");
    await other
      .locator('input[type="file"][accept=".epub,.pdf"]')
      .first()
      .setInputFiles(resolve("e2e/fixtures/test-document.pdf"));
    await browserExpect(other.locator("canvas").first()).toBeVisible();
    await other.getByRole("button", { name: "Reader menu", exact: true }).click();
    await browserExpect(other.getByRole("menuitem", { name: "Review", exact: true })).toHaveCount(
      0,
    );
  },
  120_000,
);
