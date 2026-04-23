import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, createStore, get } from "idb-keyval";
import { makeSyncEngine } from "../../sync-engine";
import type { SyncPullResponse } from "../../types";

// IDB store coordinates mirrored from app/lib/sync/stores.ts. If the db/store
// names ever change in production, this harness must be updated to match.
const bookStore = createStore("ebook-reader-db", "books");
const positionStore = createStore("ebook-reader-positions", "positions");
const highlightStore = createStore("ebook-reader-highlights", "highlights");
const notebookStore = createStore("ebook-reader-notebooks", "notebooks");
const chatSessionStore = createStore("ebook-reader-chat-sessions", "sessions");
const cursorStore = createStore("ebook-reader-sync-cursors", "cursors");
const changeLogStore = createStore("ebook-reader-changelog", "changes");

beforeEach(async () => {
  localStorage.clear();
  await Promise.all([
    clear(bookStore),
    clear(positionStore),
    clear(highlightStore),
    clear(notebookStore),
    clear(chatSessionStore),
    clear(cursorStore),
    clear(changeLogStore),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Scenario 2: pull merge applies mergers for every entity group.
describe("integration: pull merge applies mergers for every entity group", () => {
  it("writes one record per entity type (book, position, highlight, notebook, chat_session, chat_message, settings) using ENTITY_MERGERS", async () => {
    const T = "2026-04-22T12:00:00.000Z";

    const pullResponse: SyncPullResponse = {
      serverTimestamp: T,
      changes: [
        {
          entity: "book",
          records: [
            {
              id: "book-1",
              title: "Moby Dick",
              author: "Melville",
              format: "epub",
              fileHash: "hash-1",
              fileBlobUrl: "https://example.test/book.epub",
              coverBlobUrl: "https://example.test/cover.jpg",
              updatedAt: T,
            },
          ],
          cursor: T,
          hasMore: false,
        },
        {
          entity: "position",
          records: [{ bookId: "book-1", cfi: "epubcfi(/6/2)", updatedAt: T }],
          cursor: T,
          hasMore: false,
        },
        // chat_session must arrive before chat_message so the message merger
        // can find the parent session.
        {
          entity: "chat_session",
          records: [
            {
              id: "sess-1",
              bookId: "book-1",
              title: "Reading chat",
              createdAt: T,
              updatedAt: T,
            },
          ],
          cursor: T,
          hasMore: false,
        },
        {
          entity: "chat_message",
          records: [
            {
              id: "msg-1",
              sessionId: "sess-1",
              role: "user",
              content: "What's chapter 1 about?",
              createdAt: T,
            },
          ],
          cursor: T,
          hasMore: false,
        },
        {
          entity: "highlight",
          records: [
            {
              id: "hl-1",
              bookId: "book-1",
              cfiRange: "epubcfi(/6/2,/1:0,/1:5)",
              text: "Call me Ishmael",
              color: "yellow",
              createdAt: T,
              updatedAt: T,
            },
          ],
          cursor: T,
          hasMore: false,
        },
        {
          entity: "notebook",
          records: [{ bookId: "book-1", content: { type: "doc", content: [] }, updatedAt: T }],
          cursor: T,
          hasMore: false,
        },
        {
          entity: "settings",
          records: [{ settings: { theme: "dark", fontSize: 18 }, updatedAt: T }],
          cursor: T,
          hasMore: false,
        },
      ],
    };

    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("/api/sync/pull");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => pullResponse,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pullChanges();

    // book merger (LWW, server-to-local transform)
    const book = await get<Record<string, unknown>>("book-1", bookStore);
    expect(book).toMatchObject({
      id: "book-1",
      title: "Moby Dick",
      author: "Melville",
      fileHash: "hash-1",
      remoteFileUrl: "https://example.test/book.epub",
      remoteCoverUrl: "https://example.test/cover.jpg",
    });

    // position merger (LWW)
    const pos = await get<Record<string, unknown>>("book-1", positionStore);
    expect(pos).toMatchObject({ id: "book-1", cfi: "epubcfi(/6/2)" });

    // highlight merger (set-union)
    const hl = await get<Record<string, unknown>>("hl-1", highlightStore);
    expect(hl).toMatchObject({
      id: "hl-1",
      bookId: "book-1",
      text: "Call me Ishmael",
      color: "yellow",
    });

    // notebook merger (LWW)
    const nb = await get<Record<string, unknown>>("book-1", notebookStore);
    expect(nb).toMatchObject({ bookId: "book-1" });

    // chat_session metadata + chat_message append-only into same per-bookId array
    const sessions = await get<
      Array<{ id: string; messages: Array<{ id: string; content: string }> }>
    >("book-1", chatSessionStore);
    expect(sessions).toHaveLength(1);
    expect(sessions?.[0].id).toBe("sess-1");
    expect(sessions?.[0].messages.map((m) => m.id)).toEqual(["msg-1"]);

    // settings merger writes through to localStorage
    const rawSettings = localStorage.getItem("app-settings");
    expect(rawSettings).not.toBeNull();
    const parsed = JSON.parse(rawSettings as string);
    expect(parsed.theme).toBe("dark");
    expect(parsed.fontSize).toBe(18);
  });
});
