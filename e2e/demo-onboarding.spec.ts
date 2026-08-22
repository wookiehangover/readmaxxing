import { test, expect, type Page, type Request } from "@playwright/test";
import {
  installVirtualAuthenticator,
  skipIfAuthNotConfigured,
  waitForAppHydration,
} from "./helpers/auth";

const DEMO_BOOK_ID = "af6bcb3e-6cb8-4c64-8e4d-9d65b1ec19d1";
const DEMO_SESSION_ID = "39e8921b-1341-49c1-9ef8-0f03e8a36571";
const CI_ASSISTANT_RESPONSE =
  "The green light represents Gatsby's longing for an unreachable future.";

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

async function mockAiCompletions(page: Page) {
  await page.route("**/api/chat-title", async (route) => {
    await route.fulfill({ json: { title: "The green light" } });
  });

  await page.route("**/api/chapter-questions", async (route) => {
    await route.fulfill({
      json: [
        "What does the green light represent?",
        "How does Nick describe Gatsby?",
        "What does the setting reveal?",
      ],
    });
  });

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      bookId?: string;
      bookIds?: string[];
      sessionId?: string;
    };
    const bookId = body.bookId ?? body.bookIds?.[0];
    const sessionId = body.sessionId;
    if (!bookId || !sessionId) {
      await route.fulfill({ status: 400, json: { error: "bookId and sessionId are required" } });
      return;
    }

    const [bookOwnership, sessionOwnership] = await Promise.all([
      page.request.get(`/api/books/${encodeURIComponent(bookId)}/artifacts`),
      page.request.get(`/api/chat/messages/${encodeURIComponent(sessionId)}`),
    ]);
    const rejectedOwnership = [bookOwnership, sessionOwnership].find((response) => !response.ok());
    if (rejectedOwnership) {
      await route.fulfill({ response: rejectedOwnership });
      return;
    }

    const stream = [
      { type: "start", messageId: "e2e-assistant" },
      { type: "start-step" },
      { type: "text-start", id: "e2e-text" },
      { type: "text-delta", id: "e2e-text", delta: CI_ASSISTANT_RESPONSE },
      { type: "text-end", id: "e2e-text" },
      { type: "finish-step" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
      body: `${stream.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });
}

async function waitForStableDemoLibrary(page: Page) {
  const demoReaderPath = `/books/${DEMO_BOOK_ID}`;

  await expect
    .poll(
      async () => {
        if (new URL(page.url()).pathname === demoReaderPath) {
          await expect(page.getByTestId("reading-shell")).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText("Loading workspace…", { exact: true })).toBeHidden({
            timeout: 30_000,
          });
          await page.goBack();
          return false;
        }

        return page.evaluate(() => {
          const browser = window as Window & {
            __reactRouterDataRouter?: {
              state: { location: { pathname: string }; navigation: { state: string } };
            };
          };
          const router = browser.__reactRouterDataRouter;
          if (
            window.location.pathname !== "/library" ||
            router?.state.location.pathname !== "/library" ||
            router.state.navigation.state !== "idle" ||
            localStorage.getItem("demo-onboarding") !== "complete"
          ) {
            return false;
          }

          const login = document.querySelector('a[href="/login"]');
          const gatsby = document.querySelector('button[aria-label="Open The Great Gatsby"]');
          const frame = login?.closest(".app-frame");
          if (!(login instanceof HTMLElement) || !(gatsby instanceof HTMLElement) || !frame) {
            return false;
          }
          if (
            frame.classList.contains("opacity-0") ||
            frame
              .getAnimations()
              .some((animation) => animation.playState === "running" || animation.pending)
          ) {
            return false;
          }

          const bounds = login.getBoundingClientRect();
          if (bounds.width === 0 || bounds.height === 0) return false;
          const target = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
          );
          return target === login || login.contains(target);
        });
      },
      { timeout: 60_000, intervals: [100, 250, 500] },
    )
    .toBe(true);
}

async function waitForStableLoginAction(page: Page, loginAction: string) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const browser = window as Window & {
            __reactRouterDataRouter?: {
              state: { location: { pathname: string }; navigation: { state: string } };
            };
          };
          const router = browser.__reactRouterDataRouter;
          return (
            window.location.pathname === "/login" &&
            router?.state.location.pathname === "/login" &&
            router.state.navigation.state === "idle"
          );
        }),
      { timeout: 10_000, intervals: [100, 250, 500] },
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: loginAction })).toBeEnabled();
}

test.describe("Bundled Gatsby onboarding", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);

  for (const loginAction of ["Create account", "Sign in"] as const) {
    test(`${loginAction}: first Gatsby chat succeeds without reloading or using demo IDs`, async ({
      page,
      context,
      request,
    }, testInfo) => {
      await skipIfAuthNotConfigured(request);
      await installVirtualAuthenticator(context, page);
      if (process.env.E2E_CPU_THROTTLING_RATE) {
        const devtools = await context.newCDPSession(page);
        await devtools.send("Emulation.setCPUThrottlingRate", {
          rate: Number(process.env.E2E_CPU_THROTTLING_RATE),
        });
      }
      if (process.env.SKIP_AI_TESTS) await mockAiCompletions(page);
      if (loginAction === "Sign in") await prepareExistingAccount(page);

      const requests: CapturedRequest[] = [];
      const requestMap = new Map<Request, CapturedRequest>();
      const authenticationRequests: CapturedRequest[] = [];
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
        const pathname = new URL(response.url()).pathname;
        if (pathname.startsWith("/api/auth/")) {
          authenticationRequests.push({
            method: response.request().method(),
            url: pathname,
            status: response.status(),
          });
        }
      });
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      try {
        await page.goto("/");
        await waitForAppHydration(page);

        const gatsby = page.getByRole("button", { name: "Open The Great Gatsby" });
        await expect
          .poll(() => page.evaluate(() => localStorage.getItem("demo-onboarding")), {
            timeout: 30_000,
          })
          .toBe("complete");
        await waitForStableDemoLibrary(page);
        await expect(gatsby).toBeVisible({ timeout: 30_000 });
        const signedOutBooks = await readIndexedDbValue<LocalBook[]>(
          page,
          "ebook-reader-db",
          "books",
        );
        expect(signedOutBooks.filter((book) => !book.deletedAt)).toEqual([
          expect.objectContaining({ id: DEMO_BOOK_ID, title: "The Great Gatsby" }),
        ]);

        const loginLink = page.locator('a[href="/login"]').first();
        await expect(async () => {
          if (new URL(page.url()).pathname !== "/login") {
            await waitForStableDemoLibrary(page);
            await loginLink.click({ timeout: 5_000 });
          }
          await waitForStableLoginAction(page, loginAction);
        }).toPass({ timeout: 60_000, intervals: [100, 250, 500] });
        await expect(page).toHaveURL(/\/login$/);
        authenticationStarted = true;
        const verificationPath =
          loginAction === "Create account" ? "/api/auth/register-verify" : "/api/auth/login-verify";
        const verificationResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === verificationPath &&
            response.request().method() === "POST",
          { timeout: 30_000 },
        );
        await page.getByRole("button", { name: loginAction }).click();
        const verifiedResponse = await verificationResponse;
        expect(verifiedResponse.ok()).toBe(true);
        const verifiedAccount = (await verifiedResponse.json()) as {
          verified?: boolean;
          userId?: string;
          user?: { id?: string } | null;
        };
        expect(verifiedAccount.verified).toBe(true);
        const verifiedUserId = verifiedAccount.userId ?? verifiedAccount.user?.id;
        expect(verifiedUserId).toBeTruthy();

        await expect
          .poll(
            async () => {
              const response = await page.request.get("/api/auth/session");
              if (!response.ok()) return null;
              const session = (await response.json()) as { user?: { id?: string } | null };
              return session.user?.id ?? null;
            },
            { timeout: 15_000 },
          )
          .toBe(verifiedUserId);
        await waitForAppHydration(page);
        await expect(page).not.toHaveURL(/\/login$/);

        await expect
          .poll(
            async () => {
              const books = await readIndexedDbValue<LocalBook[]>(page, "ebook-reader-db", "books");
              const adopted = books.filter(
                (book) => !book.deletedAt && book.title === "The Great Gatsby",
              );
              return adopted.length === 1 && adopted[0].id !== DEMO_BOOK_ID ? adopted[0].id : null;
            },
            { timeout: 30_000 },
          )
          .not.toBeNull();
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
        const assistantResponse = page.locator(".max-w-prose.text-foreground").first();
        await expect(assistantResponse).toContainText(
          process.env.SKIP_AI_TESTS ? CI_ASSISTANT_RESPONSE : /\S+/,
          { timeout: 60_000 },
        );

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
        console.error("Authentication network:", JSON.stringify(authenticationRequests));
        console.error("Browser errors:", JSON.stringify(browserErrors));
        throw error;
      } finally {
        await testInfo.attach("authenticated-onboarding-network", {
          body: JSON.stringify(requests, null, 2),
          contentType: "application/json",
        });
        await testInfo.attach("authentication-network", {
          body: JSON.stringify(authenticationRequests, null, 2),
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
