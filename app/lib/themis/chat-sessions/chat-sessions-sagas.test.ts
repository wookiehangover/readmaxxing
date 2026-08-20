import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatSession } from "~/lib/stores/chat-store";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));

vi.mock("~/lib/stores/chat-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/stores/chat-store")>();
  return {
    ...actual,
    ChatService: new Proxy(actual.ChatService, { get: () => mocks.runPromise }),
  };
});

import { chatSessionsSaga } from "~/lib/themis/chat-sessions/chat-sessions-sagas";
import {
  cacheChatMessagesRequested,
  chatSessionsHydrated,
  createChatSessionRequested,
  deleteChatSessionRequested,
  generateChatSessionTitleRequested,
  hydrateChatSessionsRequested,
  selectChatSessionRequested,
} from "~/lib/themis/chat-sessions/chat-sessions-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const stores: AppStore[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeSession(id: string, title = ""): ChatSession {
  return { id, bookId: "book-1", title, messages: [], createdAt: 1, updatedAt: 1 };
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
  mocks.runPromise.mockReset();
  vi.unstubAllGlobals();
});

describe("chatSessionsSaga", () => {
  it("hydrates sessions from persistence", async () => {
    const session = makeSession("session-1");
    const onCompleted = vi.fn();
    mocks.runPromise.mockResolvedValueOnce([session]).mockResolvedValueOnce(session.id);
    const store = startStore();

    store.dispatch(hydrateChatSessionsRequested("book-1", true, onCompleted));

    await vi.waitFor(() => expect(onCompleted).toHaveBeenCalledWith(session));
    expect(
      store.chatSessionsSelectors.selectActiveSessionByBook.select(store.state, "book-1"),
    ).toEqual(session);
  });

  it("publishes the latest queued hydrate result for a book", async () => {
    const older = makeSession("older");
    const newer = makeSession("newer");
    const olderSessions = deferred<ChatSession[]>();
    mocks.runPromise
      .mockReturnValueOnce(olderSessions.promise)
      .mockResolvedValueOnce(older.id)
      .mockResolvedValueOnce([newer])
      .mockResolvedValueOnce(newer.id);
    const store = startStore();

    store.dispatch(hydrateChatSessionsRequested("book-1"));
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledOnce());
    store.dispatch(hydrateChatSessionsRequested("book-1"));

    expect(mocks.runPromise).toHaveBeenCalledOnce();
    olderSessions.resolve([older]);
    await vi.waitFor(() => expect(mocks.runPromise).toHaveBeenCalledTimes(4));
    expect(
      store.chatSessionsSelectors.selectActiveSessionByBook.select(store.state, "book-1"),
    ).toEqual(newer);
  });

  it("persists create, select, and delete before updating the collection", async () => {
    const first = makeSession("session-1");
    const second = makeSession("session-2");
    const onCreated = vi.fn();
    const onSelected = vi.fn();
    const onDeleted = vi.fn();
    mocks.runPromise
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(first.id);
    const store = startStore();
    store.dispatch(chatSessionsHydrated("book-1", [first, second], second.id));

    store.dispatch(createChatSessionRequested("book-1", undefined, onCreated));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(first));
    store.dispatch(selectChatSessionRequested("book-1", second.id, onSelected));
    await vi.waitFor(() => expect(onSelected).toHaveBeenCalledWith(second));
    store.dispatch(deleteChatSessionRequested("book-1", second.id, onDeleted));

    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith(first.id));
    expect(store.chatSessionsSelectors.selectActiveSessionId.select(store.state, "book-1")).toBe(
      first.id,
    );
    expect(
      store.chatSessionsSelectors.selectSessionsByBook
        .select(store.state, "book-1")
        .map((session) => session.id),
    ).toEqual([first.id]);
  });

  it("persists message cache and title updates before reducer updates", async () => {
    const session = makeSession("session-1");
    const renamed = { ...session, title: "A useful title", updatedAt: 2 };
    const messages: ChatMessage[] = [
      { id: "message-1", role: "assistant", content: "Hello", createdAt: 1 },
    ];
    mocks.runPromise
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(renamed);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ title: renamed.title }),
      }),
    );
    const store = startStore();
    store.dispatch(chatSessionsHydrated("book-1", [session], session.id));

    store.dispatch(cacheChatMessagesRequested("book-1", session.id, messages));
    await vi.waitFor(() =>
      expect(
        store.chatSessionsSelectors.selectActiveSessionByBook.select(store.state, "book-1")
          ?.messages,
      ).toEqual(messages),
    );
    store.dispatch(
      generateChatSessionTitleRequested("book-1", session.id, [
        { id: "message-1", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
      ]),
    );

    await vi.waitFor(() =>
      expect(
        store.chatSessionsSelectors.selectActiveSessionByBook.select(store.state, "book-1")?.title,
      ).toBe(renamed.title),
    );
    expect(mocks.runPromise).toHaveBeenCalledTimes(3);
  });

  it("keeps failed creates out of the collection", async () => {
    const onFailed = vi.fn();
    mocks.runPromise.mockRejectedValueOnce(new Error("IDB unavailable"));
    const store = startStore();

    store.dispatch(createChatSessionRequested("book-1", undefined, undefined, onFailed));

    await vi.waitFor(() => expect(onFailed).toHaveBeenCalledWith("IDB unavailable"));
    expect(store.chatSessionsSelectors.selectSessionsByBook.select(store.state, "book-1")).toEqual(
      [],
    );
  });
});
