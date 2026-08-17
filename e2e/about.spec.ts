import { expect, test } from "@playwright/test";

test("full-page /about does not render the workspace loading shell", async ({ page }) => {
  const response = await page.goto("/about", { waitUntil: "domcontentloaded" });

  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: /Readmaxxing/ })).toBeVisible();
  await expect(page.getByText(/Loading workspace/)).toHaveCount(0);
});
