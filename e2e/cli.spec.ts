import { test, expect } from "@playwright/test";

test("CLI authorization requires a click and supports signing in before retrying", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/cli", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 401, json: { error: "auth_required" } })
      : route.fulfill({
          json: {
            token: "12345678-1234-1234-1234-123456789abc",
            expiresAt: "2026-10-01T00:00:00Z",
          },
        });
  });
  await page.goto("/cli");
  await expect(page.getByRole("heading", { name: "Connect the Readmaxxing CLI" })).toBeVisible();
  expect(attempts).toBe(0);
  await page.getByRole("button", { name: "Authorize CLI" }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "target",
    "_blank",
  );
  await page.getByRole("button", { name: "Authorize CLI" }).click();
  await expect(
    page.getByText("12345678-1234-1234-1234-123456789abc", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize CLI" })).toHaveCount(0);
  expect(attempts).toBe(2);
});
