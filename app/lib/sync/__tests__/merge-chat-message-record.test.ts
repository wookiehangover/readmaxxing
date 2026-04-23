import { describe, it, expect, beforeEach } from "vitest";
import { createStore, clear, get, set } from "idb-keyval";

import { mergeChatMessageRecord, mergeChatSessionRecord } from "../sync-engine";

// Must match the IDB db/store names used in chat-store.ts and sync-engine.ts.
const sessionStore = createStore("ebook-reader-chat-sessions", "sessions");
const activeSessionStore = createStore("ebook-reader-active-session", "active-session");

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  createdAt: number;
}

interface StoredSession {
  id: string;
  bookId: string;
  title: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

beforeEach(async () => {
  await Promise.all([clear(sessionStore), clear(activeSessionStore)]);
});

describe("mergeChatMessageRecord: session updatedAt is metadata-only", () => {
  it("does not bump session.updatedAt when appending a message with later createdAt", async () => {
    const bookId = "book-1";
    const sessionId = "session-a";
    const T = 1_000_000;
    await set(
      bookId,
      [
        {
          id: sessionId,
          bookId,
          title: "Existing",
          messages: [],
          createdAt: T,
          updatedAt: T,
        },
      ] satisfies StoredSession[],
      sessionStore,
    );

    await mergeChatMessageRecord({
      id: "msg-1",
      sessionId,
      role: "user",
      content: "Hello",
      createdAt: new Date(T + 1000).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toHaveLength(1);
    expect(after?.[0].messages.map((m) => m.id)).toEqual(["msg-1"]);
    expect(after?.[0].updatedAt).toBe(T);
  });

  it("leaves session.updatedAt unchanged across many message merges, so a later LWW session merge still wins", async () => {
    const bookId = "book-1";
    const sessionId = "session-a";
    const T = 2_000_000;
    await set(
      bookId,
      [
        {
          id: sessionId,
          bookId,
          title: "Original",
          messages: [],
          createdAt: T,
          updatedAt: T,
        },
      ] satisfies StoredSession[],
      sessionStore,
    );

    // Append several messages, some of which carry createdAt values well past
    // T + 500. Previously this would advance the session's LWW clock past the
    // later title-change merge below and cause it to lose.
    for (let i = 0; i < 5; i++) {
      await mergeChatMessageRecord({
        id: `msg-${i}`,
        sessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
        createdAt: new Date(T + 1000 + i * 100).toISOString(),
      });
    }

    const midway = await get<StoredSession[]>(bookId, sessionStore);
    expect(midway?.[0].updatedAt).toBe(T);
    expect(midway?.[0].messages).toHaveLength(5);

    // A subsequent metadata-only LWW merge (e.g. title rename) with
    // updatedAt = T + 500 must still win: the message merges above did not
    // poison the LWW clock.
    await mergeChatSessionRecord({
      id: sessionId,
      bookId,
      title: "Renamed",
      createdAt: new Date(T).toISOString(),
      updatedAt: new Date(T + 500).toISOString(),
    });

    const after = await get<StoredSession[]>(bookId, sessionStore);
    expect(after).toHaveLength(1);
    expect(after?.[0].title).toBe("Renamed");
    expect(after?.[0].updatedAt).toBe(T + 500);
    // Local messages are preserved through the LWW metadata merge.
    expect(after?.[0].messages.map((m) => m.id)).toEqual([
      "msg-0",
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ]);
  });
});
