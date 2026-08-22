import { test, expect, type Page, type Request } from "@playwright/test";
import {
  installVirtualAuthenticator,
  skipIfAuthNotConfigured,
  waitForAppHydration,
} from "./helpers/auth";

const DEMO_BOOK_ID = "af6bcb3e-6cb8-4c64-8e4d-9d65b1ec19d1";
const DEMO_SESSION_ID = "39e8921b-1341-49c1-9ef8-0f03e8a36571";

interface CapturedRequest {
  method: string;
  url: string;
  body?: string;
  status?: number;
}

interface LocalBook {
  id: string;
  title: string;
  deletedAt?: number | null;
}

interface LocalChatSession {
  id: string;
  bookId: string;
  deletedAt?: number | null;
}

async function readIndexedDbValue<T>(
  page: Page,
  databaseName: string,
  storeName: string,
  key?: string,
): Promise<T> {
  return page.evaluate(
    ({ database, store, lookupKey }) =>
      new Promise<T>((resolve, reject) => {
        const open = indexedDB.open(database);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const objectStore = db.transaction(store, "readonly").objectStore(store);
          const request =
            lookupKey === undefined ? objectStore.getAll() : objectStore.get(lookupKey);
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(request.result as T);
          };
        };
      }),
    { database: databaseName, store: storeName, lookupKey: key },
  );
}

function relevantAuthenticatedRequest(request: Request): CapturedRequest | null {
  const url = new URL(request.url());
  const isRelevant =
    /^\/api\/sync\/files\/(upload|download)$/.test(url.pathname) ||
    /^\/api\/books\/[^/]+\/(chapters|artifacts)$/.test(url.pathname) ||
    /^\/api\/chat(?:\/(messages|resume)\/[^/]+)?$/.test(url.pathname);

  if (!isRelevant) return null;

  const captured: CapturedRequest = {
    method: request.method(),
    url: `${url.pathname}${url.search}`,
  };
  if (url.pathname === "/api/chat" || (url.pathname.endsWith("/upload") && !url.search)) {
    captured.body = request.postData() ?? undefined;
  }
  return captured;
}

async function prepareExistingAccount(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForAppHydration(page);

  const logout = await page.request.post("/api/auth/logout");
  expect(logout.ok()).toBe(true);
  await page.goto("/favicon.svg", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    localStorage.clear();
    const databases = await indexedDB.databases();
    await Promise.all(
      databases.map(
        ({ name }) =>
          new Promise<void>((resolve, reject) => {
            if (!name) return resolve();
            const deletion = indexedDB.deleteDatabase(name);
            deletion.onsuccess = () => resolve();
            deletion.onerror = () => reject(deletion.error);
            deletion.onblocked = () => reject(new Error(`Could not delete ${name}`));
          }),
      ),
    );
  });
}

test.describe("Bundled Gatsby onboarding", () => {
  test.setTimeout(180_000);

  for (const loginAction of ["Create account", "Sign in"] as const) {
    test(`${loginAction}: first Gatsby chat succeeds without reloading or using demo IDs`, async ({
      page,
      context,
      request,
    }, testInfo) => {
      await skipIfAuthNotConfigured(request);
      await installVirtualAuthenticator(context, page);
      if (loginAction === "Sign in") await prepareExistingAccount(page);

      const requests: CapturedRequest[] = [];
      const requestMap = new Map<Request, CapturedRequest>();
      const browserErrors: string[] = [];
      let documentRequestsAfterAuthentication = 0;
      let authenticationStarted = false;

      page.on("request", (outgoing) => {
        if (
          authenticationStarted &&
          outgoing.isNavigationRequest() &&
          outgoing.frame() === page.mainFrame()
        ) {
          documentRequestsAfterAuthentication++;
        }
        const captured = relevantAuthenticatedRequest(outgoing);
        if (captured) {
          requests.push(captured);
          requestMap.set(outgoing, captured);
        }
      });
      page.on("response", (response) => {
        const captured = requestMap.get(response.request());
        if (captured) captured.status = response.status();
      });
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      try {
        await page.goto("/");
        await waitForAppHydration(page);

        const gatsby = page.getByRole("button", { name: "Open The Great Gatsby" });
        await expect(gatsby).toBeVisible({ timeout: 30_000 });
        const signedOutBooks = await readIndexedDbValue<LocalBook[]>(
          page,
          "ebook-reader-db",
          "books",
        );
        expect(signedOutBooks.filter((book) => !book.deletedAt)).toEqual([
          expect.objectContaining({ id: DEMO_BOOK_ID, title: "The Great Gatsby" }),
        ]);

        await page.locator('a[href="/login"]').first().click({ timeout: 10_000 });
        await expect(page).toHaveURL(/\/login$/);
        authenticationStarted = true;
        await page.getByRole("button", { name: loginAction }).click();
        await waitForAppHydration(page);
        await expect(page).not.toHaveURL(/\/login$/);

        await expect(gatsby).toBeVisible({ timeout: 30_000 });
        const adoptedBooks = await readIndexedDbValue<LocalBook[]>(
          page,
          "ebook-reader-db",
          "books",
        );
        const adoptedGatsby = adoptedBooks.filter(
          (book) => !book.deletedAt && book.title === "The Great Gatsby",
        );
        expect(adoptedGatsby).toHaveLength(1);
        expect(adoptedGatsby[0].id).not.toBe(DEMO_BOOK_ID);
        await gatsby.click();
        await expect(page.getByTestId("reading-shell")).toBeVisible({ timeout: 30_000 });

        const books = await readIndexedDbValue<LocalBook[]>(page, "ebook-reader-db", "books");
        const accountBooks = books.filter(
          (book) => !book.deletedAt && book.title === "The Great Gatsby",
        );
        expect(accountBooks).toHaveLength(1);
        const accountBookId = accountBooks[0].id;
        expect(accountBookId).not.toBe(DEMO_BOOK_ID);

        const sessions = await readIndexedDbValue<LocalChatSession[]>(
          page,
          "ebook-reader-chat-sessions",
          "sessions",
          accountBookId,
        );
        const accountSessions = sessions.filter((session) => !session.deletedAt);
        expect(accountSessions).not.toHaveLength(0);
        expect(accountSessions.every((session) => session.bookId === accountBookId)).toBe(true);
        expect(
          accountSessions.every((session) => session.id !== DEMO_SESSION_ID),
          `Account-owned Gatsby retained the reserved demo session: ${JSON.stringify(accountSessions)}`,
        ).toBe(true);
        const activeSessionId = await readIndexedDbValue<string>(
          page,
          "ebook-reader-active-session",
          "active-session",
          accountBookId,
        );
        expect(accountSessions.some((session) => session.id === activeSessionId)).toBe(true);
        expect(activeSessionId).not.toBe(DEMO_SESSION_ID);

        await page.getByRole("tab", { name: "Discuss" }).click();
        const chatInput = page.locator('textarea[placeholder*="Ask"]').first();
        await expect(chatInput).toBeVisible({ timeout: 30_000 });

        const firstQuestion = "What does the green light represent in The Great Gatsby?";
        const firstChatResponse = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/chat") && response.request().method() === "POST",
          { timeout: 60_000 },
        );
        await chatInput.fill(firstQuestion);
        await chatInput.press("Enter");
        const chatResponse = await firstChatResponse;
        if (!chatResponse.ok()) {
          throw new Error(
            `First chat failed (${chatResponse.status()}): ${await chatResponse.text()}`,
          );
        }
        expect(chatResponse.status()).toBe(200);

        const chatRequest = chatResponse.request().postDataJSON() as {
          bookId?: string;
          bookIds?: string[];
          sessionId?: string;
        };
        expect(chatRequest.bookId ?? chatRequest.bookIds?.[0]).toBe(accountBookId);
        expect(chatRequest.sessionId).toBe(activeSessionId);
        await expect(page.getByText(firstQuestion)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(".max-w-prose.text-foreground").first()).toContainText(/\S+/, {
          timeout: 60_000,
        });

        expect(requests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: "POST",
              url: `/api/books/${accountBookId}/chapters`,
              status: 200,
            }),
            expect.objectContaining({
              method: "GET",
              url: `/api/chat/messages/${activeSessionId}`,
              status: 200,
            }),
          ]),
        );
        const uploadedAccountFiles = requests.filter(
          ({ method, url, status }) =>
            method === "POST" &&
            url.startsWith(`/api/sync/files/upload?bookId=${accountBookId}`) &&
            status === 200,
        );
        expect(uploadedAccountFiles.length).toBeGreaterThan(0);

        const staleDemoRequests = requests.filter(({ url, body }) =>
          [DEMO_BOOK_ID, DEMO_SESSION_ID].some((id) => url.includes(id) || body?.includes(id)),
        );
        expect(staleDemoRequests).toEqual([]);
        expect(documentRequestsAfterAuthentication).toBe(0);
      } catch (error) {
        console.error("Onboarding URL:", page.url());
        console.error("Onboarding network:", JSON.stringify(requests));
        console.error("Browser errors:", JSON.stringify(browserErrors));
        throw error;
      } finally {
        await testInfo.attach("authenticated-onboarding-network", {
          body: JSON.stringify(requests, null, 2),
          contentType: "application/json",
        });
        await testInfo.attach("browser-errors", {
          body: JSON.stringify(browserErrors, null, 2),
          contentType: "application/json",
        });
      }
    });
  }
});
