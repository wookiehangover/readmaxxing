import { beforeEach, describe, expect, it } from "vitest";
import { clear, createStore, del, set } from "idb-keyval";
import { clearSyncedChanges, getUnsyncedChanges, markSynced } from "~/lib/sync/change-log";
import { runInitialSyncIfNeeded } from "~/lib/sync/initial-sync";
import type { ChatSession } from "~/lib/stores/chat-store";

const INITIAL_SYNC_KEY = "initial-sync-complete";

const flagStore = createStore("ebook-reader-sync-flags", "flags");
const bookStore = createStore("ebook-reader-db", "books");
const posStore = createStore("ebook-reader-positions", "positions");
const hlStore = createStore("ebook-reader-highlights", "highlights");
const nbStore = createStore("ebook-reader-notebooks", "notebooks");
const chatStore = createStore("ebook-reader-chat-sessions", "sessions");

beforeEach(async () => {
  localStorage.clear();
  await Promise.all([
    clear(bookStore),
    clear(posStore),
    clear(hlStore),
    clear(nbStore),
    clear(chatStore),
    del(INITIAL_SYNC_KEY, flagStore),
  ]);
  const unsynced = await getUnsyncedChanges();
  if (unsynced.length > 0) {
    await markSynced(unsynced.map((c) => c.id));
    await clearSyncedChanges();
  }
  await clearSyncedChanges();
});

describe("runInitialSyncIfNeeded — chat backfill", () => {
  it("records chat_session changes but zero chat_message changes, even when messages exist in IDB", async () => {
    const session: ChatSession = {
      id: "session-1",
      bookId: "book-1",
      title: "A chat",
      createdAt: 1000,
      updatedAt: 2000,
      messages: [
        { id: "msg-1", role: "user", content: "hello", createdAt: 1001 },
        { id: "msg-2", role: "assistant", content: "hi back", createdAt: 1002 },
      ],
    };
    await set("book-1", [session], chatStore);

    await runInitialSyncIfNeeded();

    const changes = await getUnsyncedChanges();
    const sessionChanges = changes.filter((c) => c.entity === "chat_session");
    const messageChanges = changes.filter((c) => c.entity === "chat_message");

    expect(sessionChanges).toHaveLength(1);
    expect(sessionChanges[0].entityId).toBe("session-1");
    // Session metadata is recorded without the `messages` array.
    expect((sessionChanges[0].data as { messages?: unknown }).messages).toBeUndefined();

    expect(messageChanges).toHaveLength(0);
  });

  it("records no chat_message changes when there are multiple sessions with messages", async () => {
    const sessionsA: ChatSession[] = [
      {
        id: "session-a",
        bookId: "book-1",
        title: "First",
        createdAt: 1000,
        updatedAt: 1000,
        messages: [{ id: "m-a1", role: "user", content: "q", createdAt: 1001 }],
      },
    ];
    const sessionsB: ChatSession[] = [
      {
        id: "session-b",
        bookId: "book-2",
        title: "Second",
        createdAt: 2000,
        updatedAt: 2000,
        messages: [
          { id: "m-b1", role: "user", content: "q2", createdAt: 2001 },
          { id: "m-b2", role: "assistant", content: "a2", createdAt: 2002 },
        ],
      },
    ];
    await set("book-1", sessionsA, chatStore);
    await set("book-2", sessionsB, chatStore);

    await runInitialSyncIfNeeded();

    const changes = await getUnsyncedChanges();
    expect(changes.filter((c) => c.entity === "chat_message")).toHaveLength(0);
    expect(changes.filter((c) => c.entity === "chat_session")).toHaveLength(2);
  });
});

describe("runInitialSyncIfNeeded — settings backfill", () => {
  it("only enqueues synced fields and drops UI/layout fields from the legacy blob", async () => {
    localStorage.setItem(
      "app-settings",
      JSON.stringify({
        theme: "dark",
        fontSize: 120,
        fontFamily: "Merriweather",
        lineHeight: 1.7,
        colorTheme: "nord",
        // UI fields that pre-split clients might still have in the legacy
        // blob — must NOT reach the change log.
        layoutMode: "freeform",
        sidebarCollapsed: true,
        libraryView: "table",
        readerLayout: "spread",
        pdfLayout: "two-page",
        workspaceSortBy: "title",
        updatedAt: 4242,
      }),
    );

    await runInitialSyncIfNeeded();

    const changes = await getUnsyncedChanges();
    const settingsChanges = changes.filter((c) => c.entity === "settings");
    expect(settingsChanges).toHaveLength(1);

    const data = settingsChanges[0].data as Record<string, unknown>;
    expect(data).toEqual({
      theme: "dark",
      colorTheme: "nord",
      updatedAt: 4242,
    });
    expect(data).not.toHaveProperty("fontSize");
    expect(data).not.toHaveProperty("fontFamily");
    expect(data).not.toHaveProperty("lineHeight");
    expect(data).not.toHaveProperty("layoutMode");
    expect(data).not.toHaveProperty("sidebarCollapsed");
    expect(data).not.toHaveProperty("libraryView");
    expect(data).not.toHaveProperty("readerLayout");
    expect(data).not.toHaveProperty("pdfLayout");
    expect(data).not.toHaveProperty("workspaceSortBy");
    expect(settingsChanges[0].timestamp).toBe(4242);
  });

  it("records no settings change when the legacy blob has only UI fields", async () => {
    localStorage.setItem(
      "app-settings",
      JSON.stringify({
        layoutMode: "freeform",
        sidebarCollapsed: true,
        libraryView: "table",
        updatedAt: 100,
      }),
    );

    await runInitialSyncIfNeeded();

    const changes = await getUnsyncedChanges();
    expect(changes.filter((c) => c.entity === "settings")).toHaveLength(0);
  });
});
