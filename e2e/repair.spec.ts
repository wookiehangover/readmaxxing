import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { waitForAppHydration } from "./helpers/auth";

const source = readFileSync("e2e/fixtures/test-book.epub");
const sourceHash = createHash("sha256").update(source).digest("hex");
const files = unzipSync(source);
for (const name of Object.keys(files)) {
  if (name.endsWith(".xhtml"))
    files[name] = new TextEncoder().encode(
      new TextDecoder().decode(files[name]).replace(/<!DOCTYPE[^>]*>/gi, ""),
    );
}
const repaired = zipSync(files);
const repairedHash = createHash("sha256").update(repaired).digest("hex");

test("repairs an open book, shows diagnostics, downloads a copy, and replaces with a backup", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  let completed = false;
  let launches = 0;
  let bookId = "";
  await page.route("**/api/book-repair/**", async (route) => {
    const url = new URL(route.request().url());
    bookId = decodeURIComponent(url.pathname.split("/").at(-1)!);
    if (url.searchParams.get("download") === "1") {
      await route.fulfill({ contentType: "application/epub+zip", body: Buffer.from(repaired) });
      return;
    }
    if (route.request().method() === "POST") launches++;
    await route.fulfill({
      json: {
        job: {
          id: "12345678-1234-4123-8123-123456789012",
          bookId,
          sourceHash,
          status: completed ? "completed" : "running",
          error: null,
          diagnostics: completed
            ? ["Fixed navigation.", "Rendered 2 chapters in paginated and scrolled modes."]
            : ["Inspecting EPUB structure…"],
        },
      },
    });
  });
  await page.goto("/");
  await waitForAppHydration(page);
  await page
    .locator('input[type="file"][accept=".epub,.pdf"]')
    .first()
    .setInputFiles("e2e/fixtures/test-book.epub");
  await expect(page.getByTestId("reading-shell")).toBeVisible();
  await page.getByRole("button", { name: "Reader menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Fix this book", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Repair", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Inspecting EPUB structure…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace original", exact: true })).toHaveCount(0);
  completed = true;
  await expect(
    page.getByText("Rendered 2 chapters in paginated and scrolled modes."),
  ).toBeVisible();
  expect(launches).toBe(1);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain("(repaired).epub");
  await expect(page.getByRole("button", { name: "Replace original", exact: true })).toBeEnabled();
  await page.screenshot({ path: ".intent/repair-sidebar.png", fullPage: true });
  await page.getByRole("button", { name: "Replace original", exact: true }).click();
  await expect(page.getByText("Library copy replaced", { exact: true })).toBeVisible();
  const storedHash = await page.evaluate(async (id) => {
    const data = await new Promise<ArrayBuffer>((resolve, reject) => {
      const open = indexedDB.open("ebook-reader-book-data");
      open.onsuccess = () => {
        const request = open.result.transaction("book-data").objectStore("book-data").get(id);
        request.onsuccess = () => {
          resolve(request.result);
          open.result.close();
        };
        request.onerror = () => reject(request.error);
      };
    });
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }, bookId);
  expect(storedHash).toBe(repairedHash);
  await expect(page.getByRole("button", { name: "Replaced", exact: true })).toBeDisabled();
});

test("mobile Repair tab reports setup failures without offering an output", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await page.route("**/api/book-repair/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Book repair is not configured." } }),
  );
  await page.goto("/");
  await expect(page.locator('input[type="file"][accept=".epub,.pdf"]').first()).toBeAttached();
  await page
    .locator('input[type="file"][accept=".epub,.pdf"]')
    .first()
    .setInputFiles("e2e/fixtures/test-book.epub");
  await expect(page.getByTestId("mobile-reading-tabs")).toBeVisible();
  await page.getByRole("button", { name: "Reader menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Fix this book", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Repair", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Book repair is not configured.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace original", exact: true })).toHaveCount(0);
});
