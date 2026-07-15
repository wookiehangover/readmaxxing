import { readFile } from "node:fs/promises";
import { openPublication, openZipResourceProvider, resolveCfi } from "@readmaxxing/epub-successor";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, set } from "idb-keyval";
import {
  DEFAULT_DEMO_BOOK,
  DEMO_BOOK_ID,
  DEMO_BOOK_METADATA,
  DEMO_CAPABILITIES_ANSWER,
  DEMO_CHAT_SESSION,
  DEMO_EPUB_PATH,
  DEMO_INTRO_QUESTION,
  DEMO_POSITION_CFI,
  DEMO_SUGGESTED_QUESTIONS,
} from "~/lib/onboarding/demo-content";
import { spineIndexFromCfi } from "~/lib/epub/successor-reader-adapter";
import { isFirstVisit, seedDemo } from "~/lib/onboarding/demo-seed";
import type { ChatSession } from "~/lib/stores/chat-store";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getChatSessionStore,
  getNotebookStore,
  getPositionStore,
} from "~/lib/sync/stores";

vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

const OTHER_BOOK_ID = "onboarding-test-other-book";
let demoEpub: ArrayBuffer;
let authenticated = false;
let demoFetchOk = true;

beforeAll(async () => {
  const bytes = await readFile(`public${DEFAULT_DEMO_BOOK.epubPath}`);
  demoEpub = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(async () => {
  authenticated = false;
  demoFetchOk = true;
  window.localStorage.clear();
  await Promise.all([
    del(DEMO_BOOK_ID, getBookStore()),
    del(OTHER_BOOK_ID, getBookStore()),
    del(DEMO_BOOK_ID, getBookDataStore()),
    del(DEMO_BOOK_ID, getPositionStore()),
    del(DEMO_BOOK_ID, getNotebookStore()),
    del(DEMO_BOOK_ID, getChatSessionStore()),
    del(DEMO_BOOK_ID, getActiveSessionStore()),
  ]);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return new Response(
          JSON.stringify({
            user: authenticated ? { id: "user-1", displayName: "Reader" } : null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === DEFAULT_DEMO_BOOK.epubPath) {
        return new Response(demoFetchOk ? demoEpub : null, { status: demoFetchOk ? 200 : 500 });
      }
      return new Response(null, { status: 404 });
    }),
  );
});

describe("isFirstVisit", () => {
  it("is true only for a signed-out visitor with no flag and an empty library", async () => {
    expect(await isFirstVisit()).toBe(true);

    authenticated = true;
    expect(await isFirstVisit()).toBe(false);
    authenticated = false;

    await set(
      OTHER_BOOK_ID,
      {
        id: OTHER_BOOK_ID,
        title: "Existing book",
        author: "Author",
        coverImage: null,
        format: "epub",
      },
      getBookStore(),
    );
    expect(await isFirstVisit()).toBe(false);

    await del(OTHER_BOOK_ID, getBookStore());
    window.localStorage.setItem("demo-onboarding", "complete");
    expect(await isFirstVisit()).toBe(false);
  });
});

describe("seedDemo", () => {
  it("derives the public demo values from the default-book config", () => {
    expect(DEMO_BOOK_ID).toBe(DEFAULT_DEMO_BOOK.bookId);
    expect(DEMO_BOOK_METADATA).toEqual({
      ...DEFAULT_DEMO_BOOK.metadata,
      id: DEFAULT_DEMO_BOOK.bookId,
    });
    expect(DEMO_EPUB_PATH).toBe(DEFAULT_DEMO_BOOK.epubPath);
    expect(DEMO_INTRO_QUESTION).toBe(DEFAULT_DEMO_BOOK.introQuestion);
    expect(DEMO_SUGGESTED_QUESTIONS).toBe(DEFAULT_DEMO_BOOK.suggestedQuestions);
    expect(DEMO_CAPABILITIES_ANSWER).not.toContain(DEFAULT_DEMO_BOOK.metadata.title);
  });

  it("uses a resolvable Chapter 1 position in the configured EPUB", async () => {
    const provider = await openZipResourceProvider(demoEpub);
    try {
      const opened = await openPublication(provider);
      expect(opened.publication).not.toBeNull();
      const spineIndex = spineIndexFromCfi(DEMO_POSITION_CFI);
      expect(spineIndex).not.toBeNull();
      const chapter = opened.publication!.readingOrder[spineIndex!];
      expect(chapter?.href).toMatch(/chapter-1\.xhtml$/);

      const source = (await provider.readText(chapter!.href)).replace(/<link\b[^>]*\/>/g, "");
      const document = new DOMParser().parseFromString(source, "application/xhtml+xml");
      const resolved = resolveCfi(DEMO_POSITION_CFI, document, { spineIndex: spineIndex! });
      expect(resolved?.startContainer.parentElement?.closest("section")?.id).toBe("chapter-1");
    } finally {
      provider.close();
    }
  });

  it("provisions the demo content once and sets the first-visit flag", async () => {
    const book = await seedDemo();

    expect(book?.id).toBe(DEMO_BOOK_ID);
    expect(await get(DEMO_BOOK_ID, getBookStore())).toMatchObject({ id: DEMO_BOOK_ID });
    expect(await get(DEMO_BOOK_ID, getBookDataStore())).toBeInstanceOf(ArrayBuffer);
    expect(await get(DEMO_BOOK_ID, getPositionStore())).toMatchObject({ cfi: expect.any(String) });
    expect(await get(DEMO_BOOK_ID, getNotebookStore())).toMatchObject({ bookId: DEMO_BOOK_ID });

    const sessions = await get<ChatSession[]>(DEMO_BOOK_ID, getChatSessionStore());
    expect(sessions).toHaveLength(1);
    expect(sessions?.[0].id).toBe(DEMO_CHAT_SESSION.id);
    expect(sessions?.[0].messages).toEqual([]);
    expect(await get(DEMO_BOOK_ID, getActiveSessionStore())).toBe(DEMO_CHAT_SESSION.id);
    expect(window.localStorage.getItem("demo-onboarding")).toBe("complete");
    expect(await isFirstVisit()).toBe(false);

    await seedDemo();
    expect(await get<ChatSession[]>(DEMO_BOOK_ID, getChatSessionStore())).toHaveLength(1);
  });

  it("does not set the flag when provisioning fails", async () => {
    demoFetchOk = false;
    await expect(seedDemo()).rejects.toBeDefined();
    expect(window.localStorage.getItem("demo-onboarding")).toBeNull();
  });
});
