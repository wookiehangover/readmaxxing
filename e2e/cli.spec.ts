import { test, expect } from "@playwright/test";
import { startLoginCallback } from "../packages/cli/src/login-callback";

const token = "12345678-1234-1234-1234-123456789abc";
const credential = { token, expiresAt: "2026-10-01T00:00:00Z" };

test("CLI authorization requires a click and supports manual login", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/auth/cli", (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 401, json: { error: "auth_required" } })
      : route.fulfill({ json: credential });
  });
  await page.goto("/cli");
  await expect(page.getByRole("heading", { name: "Connect CLI" })).toBeVisible();
  expect(attempts).toBe(0);
  await expect(page.getByRole("button", { name: "Copy token" })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
    "target",
    "_blank",
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(token, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
  expect(attempts).toBe(2);
});

test("browser authorization reaches the temporary CLI server without copying a token", async ({
  page,
  baseURL,
}) => {
  let received: string | undefined;
  const callback = await startLoginCallback(baseURL!, async (value) => {
    received = value;
  });
  try {
    await page.route("**/api/auth/cli", (route) => route.fulfill({ json: credential }));
    await page.goto(
      `/cli?${new URLSearchParams({ callback: callback.url, state: callback.state })}`,
    );
    await expect(page.getByRole("heading", { name: "Connect CLI" })).toBeVisible();
    expect(received).toBeUndefined();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("heading", { name: "CLI connected" })).toBeVisible();
    expect(await callback.result).toBe("connected");
    expect(received).toBe(token);
    await expect(page.getByText(token, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy token" })).toHaveCount(0);
  } finally {
    await callback.close();
  }
});

test("shows a copyable token when the callback server is unreachable", async ({
  page,
  baseURL,
}) => {
  const callback = await startLoginCallback(baseURL!, async () => {});
  await callback.close();
  await page.route("**/api/auth/cli", (route) => route.fulfill({ json: credential }));
  await page.goto(`/cli?${new URLSearchParams({ callback: callback.url, state: callback.state })}`);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(token, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "CLI connected" })).toHaveCount(0);
});

test("never sends credentials to a non-loopback callback", async ({ page }) => {
  let leaked = false;
  await page.route("https://attacker.example/**", (route) => {
    leaked = true;
    return route.abort();
  });
  await page.route("**/api/auth/cli", (route) => route.fulfill({ json: credential }));
  await page.goto(
    `/cli?${new URLSearchParams({ callback: "https://attacker.example/callback", state: "a".repeat(43) })}`,
  );
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
  expect(leaked).toBe(false);
});
