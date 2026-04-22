import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Layer } from "effect";

// Mock the sync changelog so we can assert on recordChange invocations
// without touching the real changelog IDB store.
vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

import { recordChange } from "~/lib/sync/change-log";
import { ChatService, ChatServiceLive } from "../chat-store";

const run = <A, E>(e: Effect.Effect<A, E, ChatService>) =>
  Effect.runPromise(Effect.provide(e, ChatServiceLive as Layer.Layer<ChatService>));

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

    const session = await run(
      ChatService.pipe(Effect.andThen((s) => s.createSession(bookId, "Original"))),
    );
    const originalUpdatedAt = session.updatedAt;

    // Simulate clock advancing so a naive Date.now() bump would show up.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await run(
      ChatService.pipe(
        Effect.andThen((s) =>
          s.cacheServerMessages(bookId, session.id, [
            {
              id: "m1",
              role: "user",
              content: "hello",
              createdAt: Date.now(),
            },
          ]),
        ),
      ),
    );

    const after = await run(
      ChatService.pipe(Effect.andThen((s) => s.getSession(session.id, bookId))),
    );

    expect(after).not.toBeNull();
    expect(after!.messages).toHaveLength(1);
    expect(after!.messages[0].content).toBe("hello");
    // The LWW clock must not advance: bumping it on every message
    // hydration silently overwrites metadata edits from other devices.
    expect(after!.updatedAt).toBe(originalUpdatedAt);
  });

  it("does not enqueue a sync change for the cached messages", async () => {
    const bookId = uniqueBookId();

    const session = await run(ChatService.pipe(Effect.andThen((s) => s.createSession(bookId))));
    // createSession enqueues one change; isolate cacheServerMessages below.
    vi.mocked(recordChange).mockClear();

    await run(
      ChatService.pipe(
        Effect.andThen((s) =>
          s.cacheServerMessages(bookId, session.id, [
            { id: "m1", role: "assistant", content: "hi", createdAt: Date.now() },
          ]),
        ),
      ),
    );

    expect(recordChange).not.toHaveBeenCalled();
  });

  it("is a no-op when the sessionId does not exist", async () => {
    const bookId = uniqueBookId();

    await run(
      ChatService.pipe(
        Effect.andThen((s) =>
          s.cacheServerMessages(bookId, "does-not-exist", [
            { id: "m1", role: "user", content: "hi", createdAt: Date.now() },
          ]),
        ),
      ),
    );

    const sessions = await run(
      ChatService.pipe(Effect.andThen((s) => s.getSessionsByBook(bookId))),
    );
    expect(sessions).toHaveLength(0);
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("preserves a concurrent title edit that happened after the cache write", async () => {
    const bookId = uniqueBookId();

    const session = await run(
      ChatService.pipe(Effect.andThen((s) => s.createSession(bookId, "Before"))),
    );

    // Simulate: another device's rename lands via sync and we record it
    // locally by calling updateSessionTitle.
    await run(
      ChatService.pipe(Effect.andThen((s) => s.updateSessionTitle(session.id, bookId, "Renamed"))),
    );
    const renamed = await run(
      ChatService.pipe(Effect.andThen((s) => s.getSession(session.id, bookId))),
    );
    const renamedUpdatedAt = renamed!.updatedAt;

    // Now message hydration fires. Previously this would bump updatedAt
    // past the rename's timestamp, making the rename "lose" LWW on the
    // next pull. After the fix, the rename's timestamp must stick.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await run(
      ChatService.pipe(
        Effect.andThen((s) =>
          s.cacheServerMessages(bookId, session.id, [
            { id: "m1", role: "user", content: "hi", createdAt: Date.now() },
          ]),
        ),
      ),
    );

    const after = await run(
      ChatService.pipe(Effect.andThen((s) => s.getSession(session.id, bookId))),
    );
    expect(after!.title).toBe("Renamed");
    expect(after!.updatedAt).toBe(renamedUpdatedAt);
  });
});
