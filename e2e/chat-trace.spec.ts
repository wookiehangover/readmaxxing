import { test, expect, type Page } from "@playwright/test";
import type { TracePreviewState } from "./fixtures/chat-trace";

async function render(page: Page, state: TracePreviewState) {
  await page.evaluate(async (value) => {
    const path = "/e2e/fixtures/chat-trace.tsx";
    const { renderTracePreview } = await import(/* @vite-ignore */ path);
    renderTracePreview(value);
  }, state);
}

test("trace supports keyboard disclosure and preserves nested details across streaming updates", async ({
  page,
}) => {
  test.skip(!!process.env.CI, "The component fixture uses the Vite dev module endpoint.");
  await page.goto("/");
  await render(page, "running");
  const preview = page.getByRole("main", { name: "Chat trace preview" });
  const summary = preview.getByRole("button", { name: "Adding to notebook", exact: true });
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await render(page, "complete");
  const completed = preview.getByRole("button", {
    name: "Searched Walden, Read chapter, Added to notebook",
    exact: true,
  });
  await expect(completed).toHaveAttribute("aria-expanded", "false");
  await completed.focus();
  await page.keyboard.press("Space");
  const search = preview.getByRole("button", { name: /Searched Walden for/ });
  await search.click();
  await expect(
    preview.getByText("I never found the companion that was so companionable as solitude."),
  ).toBeVisible();
  await completed.click();
  await completed.click();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await render(page, "error");
  const failed = preview
    .getByRole("button", { name: "Failed to add to notebook", exact: true })
    .last();
  await failed.click();
  await expect(preview.getByText("The notebook has a newer edit. Please try again.")).toBeVisible();
  await expect(preview.locator('[data-status="running"]')).toHaveCount(0);
});
