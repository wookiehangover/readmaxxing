import { test, expect, type Page } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installVirtualAuthenticator,
  registerAndSignIn,
  skipIfAuthNotConfigured,
} from "./helpers/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_EPUB = resolve(__dirname, "fixtures/test-book.epub");
const BOOK_TITLE = "Test Book for E2E";

const ASSISTANT_BUBBLE = ".max-w-prose.text-foreground";

async function uploadTestBook(page: Page) {
  const fileInput = page.locator('input[type="file"][accept=".epub,.pdf"]').first();
  await fileInput.setInputFiles(TEST_EPUB);
  const focusedPill = page
    .getByRole("tablist", { name: "Open books" })
    .getByRole("tab", { name: new RegExp(BOOK_TITLE) });
  const freeformTab = page.locator(".dv-default-tab", { hasText: BOOK_TITLE }).first();
  await expect
    .poll(
      async () =>
        (await focusedPill
          .first()
          .isVisible()
          .catch(() => false)) || (await freeformTab.isVisible().catch(() => false)),
      { timeout: 15_000 },
    )
    .toBe(true);
}

// Chapter text matches e2e/fixtures/create-test-epub.mjs. Used to seed the
// server-side chapter cache deterministically, bypassing the client-side
// auto-upload whose timing is not under test here.
const FIXTURE_CHAPTERS = [
  {
    index: 0,
    title: "Chapter 1: The Beginning",
    text:
      "Chapter 1: The Beginning\n" +
      "This is the first chapter of our test book. It contains enough text to verify that the epub reader is working correctly.\n" +
      "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.\n" +
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  },
  {
    index: 1,
    title: "Chapter 2: The End",
    text:
      "Chapter 2: The End\n" +
      "This is the second and final chapter. It concludes our brief test book.\n" +
      "Testing search functionality: the word elephant appears exactly once in this book.",
  },
];

async function openBookAndChat(page: Page) {
  // The book auto-opens on upload (handleBookAdded -> openBook), so we skip
  // the sidebar click and wait for the reader toolbar to initialize.
  await expect(page.getByRole("button", { name: "Previous page" }).first()).toBeAttached({
    timeout: 20_000,
  });

  const textarea = page.locator('textarea[placeholder*="Ask"]');
  if ((await textarea.count()) === 0) {
    await page.getByRole("button", { name: "Chat about book" }).first().click();
  }
  await expect(textarea.first()).toBeVisible({ timeout: 15_000 });

  // Seed the server chapter cache directly so the chat endpoint has the
  // text it needs regardless of whether the client-side auto-upload has
  // fired yet. The request rides the session cookie set during register.
  const bookId = await readFirstBookIdFromIdb(page);
  // Use the browser's fetch (not page.request) so the call goes through the
  // same Vite dev middleware chain the app uses — page.request.fetch bypasses
  // that and hits a 404 from the static route matcher.
  const seedResult = await page.evaluate(
    async ({ bookId: id, chapters }) => {
      const r = await fetch(`/api/books/${id}/chapters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ chapters, format: "epub" }),
      });
      return { ok: r.ok, status: r.status, text: r.ok ? "" : (await r.text()).slice(0, 200) };
    },
    { bookId, chapters: FIXTURE_CHAPTERS },
  );
  if (!seedResult.ok) {
    throw new Error(`chapter seed failed: ${seedResult.status} ${seedResult.text}`);
  }
}

async function readFirstBookIdFromIdb(page: Page): Promise<string> {
  // Retry once if the evaluate races with an HMR reload right after upload.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.evaluate(
        () =>
          new Promise<string>((resolve, reject) => {
            const open = indexedDB.open("ebook-reader-db");
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction("books", "readonly");
              const store = tx.objectStore("books");
              const req = store.getAllKeys();
              req.onsuccess = () => {
                const keys = req.result as string[];
                db.close();
                if (keys.length === 0) reject(new Error("no books in idb"));
                else resolve(String(keys[0]));
              };
              req.onerror = () => reject(req.error);
            };
            open.onerror = () => reject(open.error);
          }),
      );
    } catch (err) {
      if (attempt === 2) throw err;
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);
    }
  }
  throw new Error("unreachable");
}

async function sendChatMessage(page: Page, text: string) {
  const input = page.locator('textarea[placeholder*="Ask"]');
  await input.fill(text);
  await input.press("Enter");
}

test.describe("Chat (server-authoritative)", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page, context, request }) => {
    // Chat + auth require Postgres. When DATABASE_URL is unset (CI without a
    // DB service) the auth endpoints respond 503 — skip the whole suite.
    await skipIfAuthNotConfigured(request);

    await installVirtualAuthenticator(context, page);

    await page.goto("/");
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });
    // Clear storage + pre-collapse the sidebar. See e2e/workspace.spec.ts
    // beforeEach for why — auto-collapse races epubjs initialization.
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      localStorage.setItem(
        "app-settings",
        JSON.stringify({ sidebarCollapsed: true, updatedAt: Date.now() }),
      );
    });

    await registerAndSignIn(page);
    await uploadTestBook(page);
    await openBookAndChat(page);
  });

  test("streams an assistant response for a basic prompt", async ({ page }) => {
    await sendChatMessage(page, "In one short sentence, what is chapter 1 about?");

    const assistant = page.locator(ASSISTANT_BUBBLE).first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect(assistant).toHaveText(/\S+/, { timeout: 60_000 });
  });

  test("append_to_notes tool updates the notebook during the stream", async ({ page }) => {
    // Open the notebook so its editor mounts and registers an append callback
    // via notebookEditorCallbackMap. With renderer: "always", the notebook
    // component stays mounted after we switch back to the chat tab.
    await page.getByRole("button", { name: "Open Notebook" }).first().click();
    const notebookTab = page.locator(".dv-default-tab", { hasText: "Notes:" });
    await expect(notebookTab.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15_000 });

    // Switch back to the chat tab so the textarea is actionable again.
    const chatTab = page.locator(".dv-default-tab", { hasText: "Discuss:" });
    await chatTab.first().click();
    const textarea = page.locator('textarea[placeholder*="Ask"]');
    await expect(textarea.first()).toBeVisible({ timeout: 10_000 });

    const marker = "E2E-APPEND-MARKER-" + Date.now();
    await sendChatMessage(
      page,
      `Please call the append_to_notes tool exactly once with the text "${marker}". Do not use any other tools.`,
    );

    // Wait for the stream to produce some visible assistant output so the
    // onFinish tool handler has had a chance to fire.
    await expect(page.locator(ASSISTANT_BUBBLE).first()).toBeVisible({ timeout: 30_000 });

    // Switch to notebook and verify the marker landed in the editor.
    await notebookTab.first().click();
    await expect(page.locator(".ProseMirror")).toContainText(marker, { timeout: 60_000 });
  });

  test("create_highlight tool applies a highlight in the reader", async ({ page }) => {
    // Pull a verbatim passage from the fixture so the server's text-anchor
    // locator finds a deterministic match.
    const passage = "The quick brown fox jumps over the lazy dog.";
    await sendChatMessage(
      page,
      `Please call the create_highlight tool with this exact text as the "text" argument: "${passage}". Do not use any other tools.`,
    );

    // Wait for an assistant bubble to appear — the onFinish handler then
    // resolves the CFI and annotates the iframe.
    await expect(page.locator(ASSISTANT_BUBBLE).first()).toBeVisible({ timeout: 30_000 });

    // The authoritative signal: a highlight row lands in IndexedDB with the
    // requested text. The iframe decoration may lag (or be styled as an SVG
    // that isn't straightforward to locate via CSS), so we assert on the
    // persisted record which confirms the full server+client tool pipeline ran.
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              new Promise<number>((resolve) => {
                const open = indexedDB.open("ebook-reader-highlights");
                open.onsuccess = () => {
                  const db = open.result;
                  const tx = db.transaction("highlights", "readonly");
                  const store = tx.objectStore("highlights");
                  const req = store.getAll();
                  req.onsuccess = () => {
                    const rows = (req.result as Array<{ text?: string }>) ?? [];
                    db.close();
                    resolve(rows.filter((r) => (r.text ?? "").includes("quick brown fox")).length);
                  };
                  req.onerror = () => {
                    db.close();
                    resolve(0);
                  };
                };
                open.onerror = () => resolve(0);
              }),
          ),
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(0);
  });

  test("resumes the stream after a mid-stream reload", async ({ page }) => {
    await sendChatMessage(
      page,
      "Write a thoughtful 4-paragraph reflection on chapter 1. Take your time.",
    );

    // Wait until the assistant bubble appears (stream started), then reload.
    await expect(page.locator(ASSISTANT_BUBBLE).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(400);

    await page.reload();
    await page.waitForSelector(".dv-dockview", { timeout: 15_000 });

    // The chat panel remounts, fetches the session's messages, and reconnects
    // to any in-flight stream via /api/chat/resume. Eventually the completed
    // assistant message should be present with a non-trivial amount of text.
    const assistant = page.locator(ASSISTANT_BUBBLE).first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const t = (await assistant.textContent()) ?? "";
          return t.length;
        },
        { timeout: 90_000, intervals: [500, 1000, 2000] },
      )
      .toBeGreaterThan(100);
  });
});
