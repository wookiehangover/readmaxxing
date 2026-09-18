import { expect, test } from "@playwright/test";
import { installReviewFixture, openReviewBook } from "./helpers/review";

test.use({ serviceWorkers: "block" });

for (const mobile of [false, true]) {
  test(`outline page processing placeholder, ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await installReviewFixture(page);
    let status: "pending" | "processing" | "done" = "pending";
    await page.route("**/api/books/*/artifacts/ingest", (route) =>
      route.fulfill({ status: 202, json: {} }),
    );
    await page.route("**/api/books/*/artifacts", (route) =>
      route.fulfill({
        json: {
          bookId: new URL(route.request().url()).pathname.split("/")[3],
          artifacts: {
            outline:
              status === "done"
                ? {
                    content:
                      '## Chapter 1\n\n<div data-outline-increment="" data-locator="chapter.xhtml#page=12" data-page="12">\n\n- A traveler leaves home.\n\n</div>',
                    revisionId: "revision-1",
                    updatedAt: new Date().toISOString(),
                  }
                : null,
            characters: null,
            wiki: null,
          },
          pendingPages: status === "done" ? [] : [{ unitId: "unit-1", page: 12, status }],
        },
      }),
    );
    await openReviewBook(page);
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    const progress = page.getByRole("status", {
      name: "Preparing outline for page 12",
      exact: true,
    });
    await expect(progress).toBeInViewport();
    await expect(progress).toContainText("12");
    await expect(progress).toContainText("Outline queued");
    await expect(progress.locator('[data-slot="skeleton"]')).toHaveCount(3);
    status = "processing";
    await expect(progress).toContainText("Generating outline");
    await page.screenshot({
      path: `.intent/artifacts/outline-progress-${mobile ? "mobile" : "desktop"}.png`,
      animations: "disabled",
    });
    status = "done";
    await expect(progress).toHaveCount(0);
    await expect(page.getByText("A traveler leaves home.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to page 12", exact: true })).toBeVisible();
  });
}

for (const mobile of [false, true]) {
  test(`keeps processing visible with a long outline, ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await installReviewFixture(page);
    let processing = false;
    await page.route("**/api/books/*/artifacts/ingest", (route) =>
      route.fulfill({ status: 202, json: {} }),
    );
    await page.route("**/api/books/*/artifacts", (route) =>
      route.fulfill({
        json: {
          bookId: new URL(route.request().url()).pathname.split("/")[3],
          artifacts: {
            outline: {
              content:
                "## Existing outline\n\n" +
                Array.from({ length: 70 }, (_, index) => `- Earlier page fact ${index + 1}.`).join(
                  "\n",
                ),
              revisionId: "revision-1",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            characters: null,
            wiki: null,
          },
          pendingPages: processing ? [{ unitId: "unit-12", page: 12, status: "processing" }] : [],
        },
      }),
    );
    await openReviewBook(page);
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    await expect(page.getByText("Earlier page fact 1.", { exact: true })).toBeInViewport();
    processing = true;
    const progress = page.getByRole("status", {
      name: "Preparing outline for page 12",
      exact: true,
    });
    await expect(progress).toBeInViewport({ timeout: 8_000 });
    await expect(page.getByText("Earlier page fact 1.", { exact: true })).toBeInViewport();
    await page.screenshot({
      path: `.intent/artifacts/outline-progress-long-${mobile ? "mobile" : "desktop"}.png`,
      animations: "disabled",
    });
  });
}
