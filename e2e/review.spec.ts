import { test, expect } from "@playwright/test";
import {
  installReviewFixture,
  openReviewBook,
  openReviewSettings,
  questionText,
  reachReview,
} from "./helpers/review";

test.use({ serviceWorkers: "block" });

for (const mobile of [false, true]) {
  test(`chapter review UI, ${mobile ? "mobile" : "desktop"}`, async ({ page }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    const fixture = await installReviewFixture(page);
    await openReviewBook(page);
    await expect(page.getByRole("switch", { name: "Chapter reviews" })).not.toBeChecked();
    await expect(
      page.getByText("Pause at the end of each chapter", { exact: false }),
    ).toBeVisible();
    await page.getByRole("switch", { name: "Chapter reviews" }).click();
    await expect(page.getByRole("combobox", { name: "Difficulty" })).toContainText("Friendly");
    await expect(page.getByRole("combobox", { name: "Grading" })).toContainText("Reading Group");
    await page.getByRole("combobox", { name: "Difficulty" }).click();
    await expect(page.getByRole("option")).toHaveText([
      "Friendly",
      "Challenging",
      "Adversarial",
      "Tyler Cowen",
    ]);
    await page.getByRole("option", { name: "Friendly", exact: true }).click();
    await page.getByRole("combobox", { name: "Grading" }).click();
    await expect(page.getByRole("option")).toHaveText([
      "Reading Group",
      "Community College",
      "Elite Professor",
      "Tyler Cowen",
    ]);
    await page.getByRole("option", { name: "Elite Professor" }).click();
    await page.screenshot({
      path: `.intent/artifacts/review-${mobile ? "mobile" : "desktop"}-settings.png`,
      animations: "disabled",
    });
    await reachReview(page, mobile);
    await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Outline", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Notes", exact: true })).toBeVisible();
    await expect(page.getByTestId("review-question")).toHaveCSS("font-size", "20px");
    await expect(page.getByTestId("review-question")).toHaveCSS("font-family", /Literata/);
    const answer = page.getByRole("textbox", { name: "Your answer" });
    await expect(answer).toHaveCSS("font-family", /Geist/);
    await answer.fill("😀".repeat(30));
    await expect(page.getByRole("button", { name: "Submit answer", exact: true })).toHaveCount(0);
    await answer.fill("😀".repeat(31));
    await expect(page.getByRole("button", { name: "Submit answer", exact: true })).toBeEnabled();
    const draft =
      "My claim connects the narrator’s choice to the consequences, but it needs more evidence.";
    await answer.fill(draft);
    const frame = page.locator('[aria-label="Book surface"] iframe').first();
    const frameHandle = await frame.elementHandle();
    await page.getByRole("button", { name: "Back to chapter" }).click();
    await expect(frame).toBeVisible();
    expect(await frameHandle?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toHaveCount(0);
    if (mobile) await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: questionText }).click();
    await expect(answer).toHaveText(draft);
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Notes", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: questionText }).click();
    await expect(answer).toHaveText(draft);
    await page.screenshot({
      path: `.intent/artifacts/review-${mobile ? "mobile" : "desktop"}-question.png`,
      animations: "disabled",
    });
    await page.reload();
    if (mobile && (await page.getByRole("tab", { name: "Read", exact: true }).count()))
      await page.getByRole("tab", { name: "Read", exact: true }).click();
    await expect(answer).toHaveText(draft);
    await page.getByRole("button", { name: "Submit answer", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Needs work" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Review feedback" })).toContainText(
      "Elite Professor",
    );
    const snapshot = page.getByRole("blockquote", { name: "Submitted answer with annotations" });
    await expect(snapshot.locator("mark")).toHaveText("claim");
    await answer.fill(
      "Revised answer with a specific example that supports my interpretation of the chapter.",
    );
    await expect(snapshot).toHaveText(draft);
    await expect(page.getByRole("button", { name: "Submit answer", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Submit answer", exact: true }).scrollIntoViewIfNeeded();
    if (mobile) {
      const button = await page
        .getByRole("button", { name: "Submit answer", exact: true })
        .boundingBox();
      const tabs = await page.getByRole("tablist", { name: "Reading sections" }).boundingBox();
      expect(button!.y + button!.height).toBeLessThan(tabs!.y);
      expect(button!.height).toBeGreaterThanOrEqual(30);
    }
    await page.screenshot({
      path: `.intent/artifacts/review-${mobile ? "mobile" : "desktop"}-feedback.png`,
      animations: "disabled",
    });
    fixture.verdict = "pass";
    fixture.failConfirmation = true;
    await page.getByRole("button", { name: "Submit answer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry confirmation" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue reading" })).toHaveCount(0);
    const gradeCalls = fixture.gradeCalls;
    fixture.failConfirmation = false;
    await page.getByRole("button", { name: "Retry confirmation" }).first().click();
    await expect(page.getByRole("button", { name: "Continue reading" })).toBeVisible();
    expect(fixture.gradeCalls).toBe(gradeCalls);
    await page.getByRole("button", { name: "Continue reading" }).click();
    await expect(page.getByTestId("review-question")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();
    await openReviewSettings(page);
    await page.getByRole("switch", { name: "Chapter reviews" }).click();
    await expect(page.getByRole("switch", { name: "Chapter reviews" })).not.toBeChecked();
  });
}

test("mobile generation recovery and offline exit remain reachable", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await installReviewFixture(page);
  fixture.failQuestion = true;
  await openReviewBook(page);
  await page.getByRole("switch", { name: "Chapter reviews" }).click();
  await reachReview(page, true, false);
  await expect(page.getByText("The question could not be generated. Try again.")).toBeVisible();
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).toBeEnabled();
  fixture.failQuestion = false;
  await page
    .getByRole("region", { name: "Chapter review settings" })
    .getByRole("button", { name: "Retry question", exact: true })
    .click();
  await page.getByRole("button", { name: questionText }).click();
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("A thoughtful answer remains editable while the network is unavailable.");
  await context.setOffline(true);
  await expect(page.getByText("You’re offline.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit answer", exact: true })).toBeDisabled();
  await answer.press("End");
  await answer.pressSequentially(" Still writing.");
  await expect(answer).toContainText("Still writing.");
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).toBeInViewport();
  await page.screenshot({
    path: ".intent/artifacts/review-mobile-offline.png",
    animations: "disabled",
  });
  const toggle = page.getByRole("switch", { name: "Chapter reviews" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();
});

test("storage failure preserves editing, retry and disable; signed-out settings stay accessible", async ({
  page,
}) => {
  const fixture = await installReviewFixture(page);
  await openReviewBook(page);
  await page.getByRole("switch", { name: "Chapter reviews" }).click();
  await reachReview(page, false);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreReviewStorage: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === "ebook-reader-reviews")
        throw new DOMException("Review fixture storage is full.", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("This draft must stay editable after a failed local save.");
  await expect(
    page.getByText("Your changes may not be saved.", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).toBeEnabled();
  await page.screenshot({
    path: ".intent/artifacts/review-desktop-storage.png",
    animations: "disabled",
  });
  await page.evaluate(() =>
    (window as unknown as { restoreReviewStorage(): void }).restoreReviewStorage(),
  );
  await page.getByRole("button", { name: "Retry saving or loading" }).first().click();
  await expect(page.getByRole("button", { name: "Retry saving or loading" })).toHaveCount(0);
  await expect(answer).toHaveText("This draft must stay editable after a failed local save.");
  fixture.authenticated = false;
  await page.reload();
  await openReviewSettings(page);
  await expect(
    page.getByText("Sign in to generate and grade reviews.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Chapter reviews" })).not.toBeChecked();
  await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();
});
