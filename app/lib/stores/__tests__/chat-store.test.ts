import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, set } from "idb-keyval";

vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

import { recordChange } from "~/lib/sync/change-log";
import { ChatService } from "../chat-store";

let bookCounter = 0;
function uniqueBookId(): string {
  return `chat-test-book-${++bookCounter}-${Date.now()}`;
}

describe("ChatService.cacheServerMessages", () => {
  beforeEach(() => {
    vi.mocked(recordChange).mockClear();
  });

  it("writes the messages array to IDB without bumping session.updatedAt", async () => {
    const bookId = uniqueBookId();

    const session = await ChatService.createSession(bookId, "Original");
    const originalUpdatedAt = session.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    await ChatService.cacheServerMessages(bookId, session.id, [
      {
        id: "m1",
        role: "user",
        content: "hello",
        createdAt: Date.now(),
      },
    ]);

    const after = await ChatService.getSession(session.id, bookId);

    expect(after).not.toBeNull();
    expect(after!.messages).toHaveLength(1);
    expect(after!.messages[0].content).toBe("hello");
    expect(after!.updatedAt).toBe(originalUpdatedAt);
  });

  it("does not enqueue a sync change for the cached messages", async () => {
    const bookId = uniqueBookId();

    const session = await ChatService.createSession(bookId);
    vi.mocked(recordChange).mockClear();

    await ChatService.cacheServerMessages(bookId, session.id, [
      { id: "m1", role: "assistant", content: "hi", createdAt: Date.now() },
    ]);

    expect(recordChange).not.toHaveBeenCalled();
  });

  it("is a no-op when the sessionId does not exist", async () => {
    const bookId = uniqueBookId();

    await ChatService.cacheServerMessages(bookId, "does-not-exist", [
      { id: "m1", role: "user", content: "hi", createdAt: Date.now() },
    ]);

    const sessions = await ChatService.getSessionsByBook(bookId);
    expect(sessions).toHaveLength(0);
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("preserves a concurrent title edit that happened after the cache write", async () => {
    const bookId = uniqueBookId();

    const session = await ChatService.createSession(bookId, "Before");

    await ChatService.updateSessionTitle(session.id, bookId, "Renamed");
    const renamed = await ChatService.getSession(session.id, bookId);
    const renamedUpdatedAt = renamed!.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await ChatService.cacheServerMessages(bookId, session.id, [
      { id: "m1", role: "user", content: "hi", createdAt: Date.now() },
    ]);

    const after = await ChatService.getSession(session.id, bookId);
    expect(after!.title).toBe("Renamed");
    expect(after!.updatedAt).toBe(renamedUpdatedAt);
  });
});

describe("ChatService migrateOldMessages", () => {
  beforeEach(() => {
    vi.mocked(recordChange).mockClear();
  });

  it("enqueues exactly one chat_session change per migrated session", async () => {
    const bookId = uniqueBookId();

    const legacyStore = createStore("ebook-reader-chats", "chats");
    await set(
      bookId,
      [
        { id: "old-1", role: "user", content: "hello", createdAt: 1000 },
        { id: "old-2", role: "assistant", content: "hi", createdAt: 2000 },
      ],
      legacyStore,
    );

    const sessions = await ChatService.getSessionsByBook(bookId);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages).toHaveLength(2);

    const chatSessionCalls = vi
      .mocked(recordChange)
      .mock.calls.filter(([arg]) => arg.entity === "chat_session");
    expect(chatSessionCalls).toHaveLength(1);
    expect(chatSessionCalls[0][0]).toMatchObject({
      entity: "chat_session",
      entityId: sessions[0].id,
      operation: "put",
    });
    const tracked = chatSessionCalls[0][0].data as Record<string, unknown>;
    expect(tracked).not.toHaveProperty("messages");
    expect(tracked).toMatchObject({ bookId, title: "" });
  });

  it("does not enqueue any change when there are no legacy messages", async () => {
    const bookId = uniqueBookId();

    const sessions = await ChatService.getSessionsByBook(bookId);

    expect(sessions).toHaveLength(0);
    expect(recordChange).not.toHaveBeenCalled();
  });
});
