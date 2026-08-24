import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";

const pagesWithMockedChapterQuestions = new WeakSet<Page>();

/**
 * Skip the current test when the auth/DB stack is not configured. CI runs
 * without a Postgres service, in which case /api/auth/register-options
 * responds 503 and the WebAuthn registration flow cannot complete.
 */
export async function skipIfAuthNotConfigured(request: APIRequestContext) {
  const probe = await request.get("/api/auth/register-options");
  test.skip(probe.status() === 503, "Auth/DB not configured for chat e2e");
}

/**
 * Register a CDP virtual authenticator so the WebAuthn ceremony succeeds
 * without hitting a real security device. Must be called before any
 * navigator.credentials.* call on `page`.
 */
export async function installVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

export async function waitForAppHydration(page: Page) {
  if (process.env.SKIP_AI_TESTS && !pagesWithMockedChapterQuestions.has(page)) {
    await page.route("**/api/chapter-questions", (route) => route.fulfill({ json: [] }));
    pagesWithMockedChapterQuestions.add(page);
  }

  const libraryNavigation = page.getByRole("navigation", { name: "Library navigation" });
  const readingShell = page.getByTestId("reading-shell");

  await expect
    .poll(
      async () =>
        (await libraryNavigation.isVisible().catch(() => false)) ||
        (await readingShell.isVisible().catch(() => false)),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * Register a fresh passkey via the /login page. Leaves the user signed in
 * and back on the hydrated library or reading route.
 */
export async function registerAndSignIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).click();
  await waitForAppHydration(page);

  // AuthProvider resolves /api/auth/session asynchronously after navigate;
  // the chat panel short-circuits to the "Sign in" CTA until isAuthenticated
  // is true. Wait for the session cookie to confirm, then reload so the
  // AuthProvider boots with isAuthenticated=true on its initial render —
  // avoids the brief unauthenticated window that skips the chapters upload.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/auth/session");
        if (!res.ok()) return null;
        const body = (await res.json()) as { user?: { id?: string } | null };
        return body.user?.id ?? null;
      },
      { timeout: 15_000, intervals: [200, 300, 500, 750, 1000] },
    )
    .not.toBeNull();
  await page.reload();
  await waitForAppHydration(page);
}
