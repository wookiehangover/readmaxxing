import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");
const REPORTED_TYPE_ERROR = "Cannot read properties of undefined (reading '0')";

async function resetSignedOutState(page: Page) {
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolveDelete) => {
            if (!db.name) {
              resolveDelete();
              return;
            }
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = () => resolveDelete();
            req.onerror = () => resolveDelete();
            req.onblocked = () => resolveDelete();
          }),
      ),
    );
    localStorage.clear();
    sessionStorage.clear();
  });
}

test("signed-out first upload auto-opens readable epub without reported TypeError", async ({
  page,
}) => {
  const reportedErrors: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && text.includes(REPORTED_TYPE_ERROR)) {
      reportedErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    const text = `${error.name}: ${error.message}`;
    if (text.includes(REPORTED_TYPE_ERROR)) {
      reportedErrors.push(text);
    }
  });

  await resetSignedOutState(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_EPUB);

  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 20_000,
  });
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          const text = await frame
            .locator("body")
            .textContent({ timeout: 1_000 })
            .catch(() => "");
          if ((text?.trim().length ?? 0) > 20) return true;
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  expect(reportedErrors).toEqual([]);
});
