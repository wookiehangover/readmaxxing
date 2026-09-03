import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  installReviewFixture,
  openReviewBook,
  openReviewSettings,
  questionText,
} from "./helpers/review";

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, hasTouch: true });

async function touchForward(page: Page) {
  const iframe = page.locator('[aria-label="Book surface"] iframe').first();
  await expect(iframe).toBeVisible();
  const box = await iframe.boundingBox();
  if (!box) throw new Error("Reader iframe is not visible");
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + Math.min(box.height / 2, 200);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width * 0.85, y }],
    });
    for (const fraction of [0.7, 0.5, 0.3, 0.1])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + box.width * fraction, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

for (const mode of ["single", "scroll"] as const) {
  test(`${mode} review spans same-spine and continuation boundaries with disable recovery`, async ({
    page,
  }, testInfo) => {
    const files = unzipSync(await readFile("e2e/fixtures/test-book.epub"));
    const xhtml = (body: string) =>
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Review boundaries</title></head><body>${body}</body></html>`;
    files["OEBPS/chapter1.xhtml"] = strToU8(
      xhtml(
        '<h1 id="first">FIRST CHAPTER</h1><p>First chapter evidence.</p><h1 id="second">SECOND CHAPTER</h1>' +
          "<p>Second chapter evidence and reasoning.</p>".repeat(12),
      ),
    );
    files["OEBPS/chapter2.xhtml"] = strToU8(
      xhtml("<p>FINAL CONTINUATION evidence at the end of the book.</p>"),
    );
    files["OEBPS/nav.xhtml"] = strToU8(
      strFromU8(files["OEBPS/nav.xhtml"]).replace(
        /<ol>[\s\S]*<\/ol>/,
        '<ol><li><a href="chapter1.xhtml#first">First</a></li><li><a href="chapter1.xhtml#second">Second</a></li></ol>',
      ),
    );
    const file = testInfo.outputPath("review-boundaries.epub");
    await writeFile(file, zipSync(files));
    let releaseQuestion = () => {};
    let releaseGrade = () => {};
    try {
      const fixture = await installReviewFixture(page);
      await openReviewBook(page, file);
      if (mode === "scroll") {
        await page.getByRole("tab", { name: "Read", exact: true }).click();
        await page.getByRole("button", { name: "Reader menu", exact: true }).click();
        await page.getByRole("menuitem", { name: "Formatting", exact: true }).click();
        await page.getByRole("menuitemradio", { name: "Continuous Scroll", exact: true }).click();
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await openReviewSettings(page);
      }

      let enteredQuestion = false;
      await page.route(
        "**/api/reviews/question",
        async (route) => {
          enteredQuestion = true;
          await new Promise<void>((resolve) => {
            releaseQuestion = resolve;
          });
          await route.fallback();
        },
        { times: 1 },
      );
      await page.getByRole("switch", { name: "Chapter reviews" }).tap();
      await page.getByRole("tab", { name: "Read", exact: true }).tap();
      if (mode === "single") await touchForward(page);
      else {
        await page.locator('[aria-label="Book surface"] iframe').first().hover();
        await page.mouse.wheel(0, 1000);
      }
      await expect.poll(() => enteredQuestion).toBe(true);
      await expect(page.getByText("Preparing your chapter question…").first()).toBeVisible();
      await page.getByRole("tab", { name: "Review", exact: true }).tap();
      await page.getByRole("switch", { name: "Chapter reviews" }).tap();
      releaseQuestion();
      await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();
      await expect(page.getByTestId("review-question")).toHaveCount(0);
      await page.getByRole("switch", { name: "Chapter reviews" }).tap();
      await page.getByRole("tab", { name: "Read", exact: true }).tap();
      if (mode === "single") await touchForward(page);
      else {
        await page.locator('[aria-label="Book surface"] iframe').first().hover();
        await page.mouse.wheel(0, 1000);
      }
      await expect(page.getByTestId("review-question")).toBeVisible();
      const firstKey = fixture.assignment!.chapter.chapterKey;
      expect(fixture.assignment!.chapter.boundary.start.spineIndex).toBe(0);
      expect(fixture.assignment!.chapter.boundary.end?.spineIndex).toBe(0);
      const answer = page.getByRole("textbox", { name: "Your answer" });
      await answer.fill(
        "This private draft survives returning to the reviewed chapter and its question.",
      );
      await page.getByRole("button", { name: "Back to chapter" }).tap();
      const frame = page.locator('[aria-label="Book surface"] iframe').first().contentFrame();
      await expect(frame.locator("body")).toContainText("FIRST CHAPTER");
      await expect.poll(() => frame.locator("body").innerText()).not.toContain("SECOND CHAPTER");
      // A direct TOC attempt cannot reveal the adjacent fragment during the checkpoint.
      await page.getByRole("button", { name: "Reader menu", exact: true }).click();
      await page.getByRole("menuitem", { name: "Table of Contents", exact: true }).click();
      await page.getByRole("button", { name: "Second", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect.poll(() => frame.locator("body").innerText()).not.toContain("SECOND CHAPTER");
      await page.getByRole("tab", { name: "Review", exact: true }).tap();
      await page.getByRole("button", { name: questionText, exact: true }).tap();
      await expect(answer).toContainText("private draft");
      fixture.verdict = "pass";
      await page.getByRole("button", { name: "Submit answer", exact: true }).tap();
      await expect(page.getByRole("button", { name: "Continue reading" })).toBeVisible();
      await page.getByRole("button", { name: "Continue reading" }).tap();
      await expect(page.getByTestId("review-question")).toHaveCount(0);
      for (
        let step = 0;
        step < 20 && !(await page.getByTestId("review-question").isVisible());
        step++
      ) {
        if (mode === "single") await touchForward(page);
        else {
          const iframe = page.locator('[aria-label="Book surface"] iframe').first();
          await iframe.hover();
          await page.mouse.wheel(0, 1000);
        }
        await expect
          .poll(() => page.getByTestId("review-question").isVisible(), { timeout: 500 })
          .toBe(true)
          .catch(() => {});
      }
      await expect(page.getByTestId("review-question")).toBeVisible();
      expect(fixture.assignment!.chapter.chapterKey).not.toBe(firstKey);
      expect(fixture.assignment!.chapter.boundary.start.spineIndex).toBe(0);
      expect(fixture.assignment!.chapter.boundary.end).toBeNull();
      await page.getByRole("button", { name: "Back to chapter" }).tap();
      await expect(
        page.locator('[aria-label="Book surface"] iframe').first().contentFrame().locator("body"),
      ).toContainText("FINAL CONTINUATION");
      await page.getByRole("tab", { name: "Review", exact: true }).tap();
      await page.getByRole("button", { name: questionText, exact: true }).tap();
      await answer.fill(
        "The final answer remains editable after disabling a pending grading request.",
      );

      let enteredGrade = false;
      await page.route(
        "**/api/reviews/attempts",
        async (route) => {
          enteredGrade = true;
          await new Promise<void>((resolve) => {
            releaseGrade = resolve;
          });
          await route.fallback();
        },
        { times: 1 },
      );
      await page.getByRole("button", { name: "Submit answer", exact: true }).tap();
      await expect.poll(() => enteredGrade).toBe(true);
      await page.getByRole("tab", { name: "Review", exact: true }).tap();
      await page.getByRole("switch", { name: "Chapter reviews" }).tap();
      releaseGrade();
      await expect(page.getByRole("tab", { name: "Discuss", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Read", exact: true }).tap();
      await expect(page.getByTestId("review-question")).toHaveCount(0);
      await page.screenshot({ path: `.intent/artifacts/final-${mode}-boundary-recovery.png` });
    } finally {
      releaseQuestion();
      releaseGrade();
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });
}
