import { describe, expect, it } from "vitest";

import type { ChatMessage, ChatSession } from "~/lib/stores/chat-store";
import {
  chatMessagesCached,
  chatSessionDeleted,
  chatSessionsHydrated,
  chatSessionsReducer,
} from "~/lib/themis/chat-sessions/chat-sessions-slice";
import { createAppStore } from "~/lib/themis/store";

function makeSession(id: string, bookId = "book-1", updatedAt = 1): ChatSession {
  return {
    id,
    bookId,
    title: `Session ${id}`,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("chatSessionsReducer", () => {
  it("hydrates canonical sessions and derives recent and active views", () => {
    const oldSession = makeSession("old", "book-1", 1);
    const recentSession = makeSession("recent", "book-1", 2);
    const otherBookSession = makeSession("other", "book-2", 3);
    let state = chatSessionsReducer(
      undefined,
      chatSessionsHydrated("book-2", [otherBookSession], otherBookSession.id),
    );
    state = chatSessionsReducer(
      state,
      chatSessionsHydrated("book-1", [oldSession, recentSession], oldSession.id),
    );
    const store = createAppStore();
    const dispose = store.init();
    const appState = { ...store.state, chatSessions: state };

    expect(
      store.chatSessionsSelectors.selectRecentSessionsByBook
        .select(appState, "book-1")
        .map((session) => session.id),
    ).toEqual(["recent", "old"]);
    expect(
      store.chatSessionsSelectors.selectActiveSessionByBook.select(appState, "book-1"),
    ).toEqual(oldSession);
    expect(store.chatSessionsSelectors.selectSessionsByBook.select(appState, "book-2")).toEqual([
      otherBookSession,
    ]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    dispose();
  });

  it("updates cached messages and removes deleted sessions", () => {
    const session = makeSession("session-1");
    const hydrated = chatSessionsReducer(
      undefined,
      chatSessionsHydrated("book-1", [session], session.id),
    );
    const messages: ChatMessage[] = [
      { id: "message-1", role: "user", content: "Hello", createdAt: 1 },
    ];
    const cached = chatSessionsReducer(hydrated, chatMessagesCached(session.id, messages));
    const deleted = chatSessionsReducer(cached, chatSessionDeleted("book-1", session.id, null));
    const store = createAppStore();
    const dispose = store.init();

    expect(
      store.chatSessionsSelectors.selectActiveSessionByBook.select(
        { ...store.state, chatSessions: cached },
        "book-1",
      )?.messages,
    ).toEqual(messages);
    expect(
      store.chatSessionsSelectors.selectSessionsByBook.select(
        { ...store.state, chatSessions: deleted },
        "book-1",
      ),
    ).toEqual([]);
    expect(deleted.activeSessionIdsByBook["book-1"]).toBeUndefined();
    expect(chatSessionsReducer(deleted, { type: "unknown" })).toBe(deleted);
    dispose();
  });
});
