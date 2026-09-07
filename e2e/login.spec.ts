import { expect, test } from "@playwright/test";
import { DEMO_BOOK_ID } from "../app/lib/onboarding/demo-content";
import {
  installVirtualAuthenticator,
  registerAndSignIn,
  skipIfAuthNotConfigured,
} from "./helpers/auth";

test("existing-account sign-in reaches the library despite an incomplete local demo", async ({
  page,
  context,
  request,
}) => {
  await skipIfAuthNotConfigured(request);
  await installVirtualAuthenticator(context, page);
  await page.addInitScript(() => localStorage.setItem("demo-onboarding", "complete"));
  await registerAndSignIn(page);
  const originalSession = await (await page.request.get("/api/auth/session")).json();
  expect(originalSession.user?.id).toBeTruthy();

  await context.clearCookies();
  await page.goto("/login");
  // Simulate a browser where onboarding saved book metadata but not the EPUB/chat.
  await page.evaluate(async (bookId) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("ebook-reader-db");
      request.onupgradeneeded = () => request.result.createObjectStore("books");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("books", "readwrite");
        tx.objectStore("books").put(
          {
            id: bookId,
            title: "The Great Gatsby",
            author: "F. Scott Fitzgerald",
            coverImage: null,
            format: "epub",
          },
          bookId,
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  }, DEMO_BOOK_ID);

  const optionsResponse = page.waitForResponse("**/api/auth/login-options");
  const verificationResponse = page.waitForResponse("**/api/auth/login-verify");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await (await optionsResponse).json()).options.userVerification).toBe("required");
  const verified = await verificationResponse;
  expect(verified.ok()).toBe(true);
  expect((await verified.json()).user.id).toBe(originalSession.user.id);

  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByRole("navigation", { name: "Library navigation" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const session = await (await page.request.get("/api/auth/session")).json();
  expect(session.user.id).toBe(originalSession.user.id);
});
