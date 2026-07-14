import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, set } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
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
  const bytes = await readFile("public/demo/the-great-gatsby.epub");
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
      if (url === "/demo/the-great-gatsby.epub") {
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
