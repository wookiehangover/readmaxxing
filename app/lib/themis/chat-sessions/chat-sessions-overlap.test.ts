import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/sync/change-log", () => ({
  recordChange: vi.fn().mockResolvedValue(undefined),
}));

import { ChatService } from "~/lib/stores/chat-store";
import { chatSessionsSaga } from "~/lib/themis/chat-sessions/chat-sessions-sagas";
import { hydrateChatSessionsRequested } from "~/lib/themis/chat-sessions/chat-sessions-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function startStore() {
  const store = createAppStore();
  stores.push(store);
  store.init();
  store.runSaga(chatSessionsSaga);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.restoreAllMocks();
});

describe("chat session hydrate overlap", () => {
  it("serializes create-if-missing and publishes the final persisted state", async () => {
    const bookId = `chat-hydrate-overlap-${crypto.randomUUID()}`;
    const firstCreateStarted = deferred<void>();
    const secondCreateStarted = deferred<void>();
    const firstCreatePersisted = deferred<void>();
    const originalCreateSession = ChatService.createSession;
    let createCalls = 0;
    const createSession = vi
      .spyOn(ChatService, "createSession")
      .mockImplementation(async (...args) => {
        const callNumber = ++createCalls;
        if (callNumber === 1) {
          firstCreateStarted.resolve();
          await Promise.race([
            secondCreateStarted.promise,
            new Promise((resolve) => setTimeout(resolve, 50)),
          ]);
        } else {
          secondCreateStarted.resolve();
        }
        try {
          return await originalCreateSession(...args);
        } finally {
          if (callNumber === 1) firstCreatePersisted.resolve();
        }
      });
    const firstCompleted = vi.fn();
    const secondCompleted = vi.fn();
    const store = startStore();

    store.dispatch(hydrateChatSessionsRequested(bookId, true, firstCompleted));
    await firstCreateStarted.promise;
    store.dispatch(hydrateChatSessionsRequested(bookId, true, secondCompleted));

    await vi.waitFor(() => expect(secondCompleted).toHaveBeenCalledOnce());
    await firstCreatePersisted.promise;
    const persistedSessions = await ChatService.getSessionsByBook(bookId);
    const persistedActiveId = await ChatService.getActiveSessionId(bookId);
    const publishedSessions = store.chatSessionsSelectors.selectSessionsByBook.select(
      store.state,
      bookId,
    );

    expect(createSession).toHaveBeenCalledOnce();
    expect(firstCompleted).toHaveBeenCalledOnce();
    expect(persistedSessions).toHaveLength(1);
    expect(publishedSessions).toEqual(persistedSessions);
    expect(store.chatSessionsSelectors.selectActiveSessionId.select(store.state, bookId)).toBe(
      persistedActiveId,
    );
  });
});
