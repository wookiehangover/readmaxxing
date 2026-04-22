import { describe, it, expect, beforeEach } from "vitest";
import { createStore, clear, get, set } from "idb-keyval";

import { mergeChatSessionRecord } from "../sync-engine";

// Must match the IDB db/store names used in chat-store.ts and sync-engine.ts.
const sessionStore = createStore("ebook-reader-chat-sessions", "sessions");
const activeSessionStore = createStore("ebook-reader-active-session", "active-session");

interface StoredSession {
  id: string;
  bookId: string;
  title: string;
  messages: unknown[];
  createdAt: number;
  updatedAt: number;
}

beforeEach(async () => {
  await Promise.all([clear(sessionStore), clear(activeSessionStore)]);
});

describe("mergeChatSessionRecord tombstone handling", () => {
  it("removes a locally-known session when the server delivers a tombstone", async () => {
    const bookId = "book-1";
    const sessionId = "session-a";
    await set(
      bookId,
      [
        {
          id: sessionId,
          bookId,
          title: "Hello",
          messages: [{ id: "m1", role: "user", content: "hi", createdAt: 10 }],
          createdAt: 10,
          updatedAt: 100,
        },
      ] satisfies StoredSession[],
      sessionStore,
    );
    await set(bookId, sessionId, activeSessionStore);

    await mergeChatSessionRecord({
      id: sessionId,
      bookId,
      title: "Hello",
      createdAt: new Date(10).toISOString(),
      updatedAt: new Date(200).toISOString(),
      deletedAt: new Date(200).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toEqual([]);

    const activeAfter = await get<string>(bookId, activeSessionStore);
    expect(activeAfter).toBeUndefined();
  });

  it("keeps other sessions for the same book intact when one is tombstoned", async () => {
    const bookId = "book-1";
    await set(
      bookId,
      [
        {
          id: "session-a",
          bookId,
          title: "Gone",
          messages: [],
          createdAt: 10,
          updatedAt: 100,
        },
        {
          id: "session-b",
          bookId,
          title: "Stays",
          messages: [],
          createdAt: 20,
          updatedAt: 150,
        },
      ] satisfies StoredSession[],
      sessionStore,
    );
    await set(bookId, "session-a", activeSessionStore);

    await mergeChatSessionRecord({
      id: "session-a",
      bookId,
      title: "Gone",
      createdAt: new Date(10).toISOString(),
      updatedAt: new Date(200).toISOString(),
      deletedAt: new Date(200).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toHaveLength(1);
    expect(after?.[0].id).toBe("session-b");

    // active pointer falls back to the remaining session
    const activeAfter = await get<string>(bookId, activeSessionStore);
    expect(activeAfter).toBe("session-b");
  });

  it("is a no-op when the tombstoned session is already absent locally", async () => {
    const bookId = "book-1";
    await set(bookId, [] satisfies StoredSession[], sessionStore);

    await mergeChatSessionRecord({
      id: "session-a",
      bookId,
      title: "",
      createdAt: new Date(10).toISOString(),
      updatedAt: new Date(200).toISOString(),
      deletedAt: new Date(200).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toEqual([]);
  });

  it("keeps the local session when its updatedAt is strictly newer than the tombstone", async () => {
    const bookId = "book-1";
    const sessionId = "session-a";
    await set(
      bookId,
      [
        {
          id: sessionId,
          bookId,
          title: "Local rename",
          messages: [],
          createdAt: 10,
          updatedAt: 500,
        },
      ] satisfies StoredSession[],
      sessionStore,
    );

    await mergeChatSessionRecord({
      id: sessionId,
      bookId,
      title: "Old",
      createdAt: new Date(10).toISOString(),
      updatedAt: new Date(200).toISOString(),
      deletedAt: new Date(200).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toHaveLength(1);
    expect(after?.[0].title).toBe("Local rename");
  });
});
