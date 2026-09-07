import { test, expect, type Page } from "@playwright/test";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { installVirtualAuthenticator } from "./helpers/auth";

test.use({ serviceWorkers: "block" });

const demoId = "af6bcb3e-6cb8-4c64-8e4d-9d65b1ec19d1";
const demoSessionId = "39e8921b-1341-49c1-9ef8-0f03e8a36571";
type LocalRecord = {
  id: string;
  title?: string;
  bookId?: string;
  deletedAt?: number;
  [key: string]: unknown;
};

async function readRecords(page: Page, database: string, store: string): Promise<LocalRecord[]> {
  return page.evaluate(
    async ({ database, store }) => {
      return new Promise<LocalRecord[]>((resolve, reject) => {
        const request = indexedDB.open(database);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const transaction = db.transaction(store);
          const read = transaction.objectStore(store).getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      });
    },
    { database, store },
  );
}

test("one Gatsby survives failed saves, repeated refresh, and existing-account passkey relogin", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const user = { id: "00000000-0000-4000-8000-000000000001", displayName: "Disposable reader" };
  const origin = new URL(baseURL!).origin;
  const rpID = new URL(origin).hostname;
  let signedIn = false;
  let challenge = "";
  let credential: WebAuthnCredential | undefined;
  let failPush = true;
  let releasePush!: () => void;
  const stalledPush = new Promise<void>((resolve) => {
    releasePush = resolve;
  });
  let pushStarted = false;
  let pullCount = 0;
  let verifiedLogins = 0;
  const accepted = new Map<string, LocalRecord>();
  const requests: { path: string; status: number }[] = [];
  const cloudBook = {
    id: "cloud-book",
    title: "Existing cloud book",
    author: "Reader",
    format: "epub",
    updatedAt: new Date().toISOString(),
  };
  await installVirtualAuthenticator(context, page);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    let status = 200;
    if (path === "/api/auth/register-options") {
      const options = await generateRegistrationOptions({
        rpName: "Disposable reader",
        rpID,
        userName: user.id,
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      });
      challenge = options.challenge;
      body = { options, userId: user.id, challengeId: "registration" };
    } else if (path === "/api/auth/register-verify") {
      const verification = await verifyRegistrationResponse({
        response: route.request().postDataJSON().response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      expect(verification.verified).toBe(true);
      credential = verification.registrationInfo!.credential;
      signedIn = true;
      body = { verified: true, userId: user.id };
    } else if (path === "/api/auth/login-options") {
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [{ id: credential!.id }],
        userVerification: "required",
      });
      challenge = options.challenge;
      body = { options, challengeId: "authentication" };
    } else if (path === "/api/auth/login-verify") {
      const verification = await verifyAuthenticationResponse({
        response: route.request().postDataJSON().response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: credential!,
      });
      expect(verification.verified).toBe(true);
      credential!.counter = verification.authenticationInfo.newCounter;
      verifiedLogins++;
      signedIn = true;
      body = { verified: true, user };
    } else if (path === "/api/auth/session") {
      body = { user: signedIn ? user : null };
    } else if (path === "/api/auth/logout") {
      signedIn = false;
    } else if (path === "/api/sync/pull") {
      pullCount++;
      body = {
        changes: [{ entity: "book", records: [cloudBook], cursor: new Date().toISOString() }],
        serverTimestamp: new Date().toISOString(),
      };
    } else if (path === "/api/sync/push") {
      pushStarted = true;
      await stalledPush;
      const changes = route.request().postDataJSON().changes as LocalRecord[];
      expect(JSON.stringify(changes)).not.toContain(demoId);
      expect(JSON.stringify(changes)).not.toContain(demoSessionId);
      if (failPush) {
        status = 503;
        body = { error: "Disposable sync outage" };
      } else {
        for (const change of changes) accepted.set(change.id, change);
        body = {
          accepted: changes.map((change) => ({ id: change.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        };
      }
    } else if (path.startsWith("/api/sync/files")) {
      status = 503;
      body = { error: "Files remain local in this fixture" };
    } else if (path === "/api/reviews" || path.includes("chapter-questions")) {
      body = [];
    }
    requests.push({ path, status });
    await route.fulfill({ status, json: body });
  });

  try {
    await page.goto("/");
    await expect(page.getByTestId("reading-shell")).toBeVisible();
    await expect(page.getByTestId("workspace-loading-overlay")).toBeHidden();
    await page.goto("/library");
    await expect(page.getByRole("button", { name: "Select The Great Gatsby" })).toBeVisible();
    await page.goto("/login");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    await expect.poll(() => pushStarted).toBe(true);
    await expect(page.getByRole("button", { name: "Select Existing cloud book" })).toBeVisible();
    expect(requests.some((request) => request.path === "/api/sync/push")).toBe(false);
    expect((await readRecords(page, "ebook-reader-changelog", "changes")).length).toBeGreaterThan(
      0,
    );
  } finally {
    releasePush();
  }
  await expect
    .poll(() =>
      requests.some((request) => request.path === "/api/sync/push" && request.status === 503),
    )
    .toBe(true);
  const activeGatsby = async () =>
    (await readRecords(page, "ebook-reader-db", "books")).filter(
      (book) => book.title === "The Great Gatsby" && book.deletedAt == null,
    );
  const first = await activeGatsby();
  expect(first).toHaveLength(1);
  expect(first[0].id).not.toBe(demoId);
  const initialPending = await readRecords(page, "ebook-reader-changelog", "changes");
  expect(initialPending.length).toBeGreaterThan(0);
  for (let refresh = 0; refresh < 3; refresh++) {
    await page.reload();
    await expect(page.getByRole("button", { name: "Select Existing cloud book" })).toBeVisible();
    expect((await activeGatsby()).map((book) => book.id)).toEqual([first[0].id]);
    const pending = await readRecords(page, "ebook-reader-changelog", "changes");
    expect(pending.map((change) => change.id)).toEqual(
      expect.arrayContaining(initialPending.map((change) => change.id)),
    );
  }
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  expect(verifiedLogins).toBe(1);
  expect((await activeGatsby()).map((book) => book.id)).toEqual([first[0].id]);
  expect(pullCount).toBeGreaterThan(0);
  failPush = false;
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        return initialPending.every((change) => accepted.has(change.id));
      },
      { timeout: 40_000, intervals: [1000] },
    )
    .toBe(true);
  expect((await activeGatsby()).map((book) => book.id)).toEqual([first[0].id]);
  const files = await page.evaluate(
    async (bookId) =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open("ebook-reader-book-data");
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction("book-data").objectStore("book-data").get(bookId);
          read.onsuccess = () => {
            db.close();
            resolve(read.result instanceof ArrayBuffer && read.result.byteLength > 0);
          };
        };
      }),
    first[0].id,
  );
  expect(files).toBe(true);
  await testInfo.attach("disposable-auth-sync-evidence", {
    body: JSON.stringify(
      {
        requests,
        verifiedLogins,
        bookId: first[0].id,
        preservedChanges: initialPending.map((change) => change.id),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
