import { describe, it, expect, beforeEach } from "vitest";
import { createStore, get, set, entries } from "idb-keyval";
import { remapBookId } from "../remap";

let counter = 0;
function makeStores() {
  const suffix = `remap-${++counter}-${Date.now()}`;
  const stores = {
    bookStore: createStore(`${suffix}-books`, "books"),
    bookDataStore: createStore(`${suffix}-book-data`, "book-data"),
    positionStore: createStore(`${suffix}-positions`, "positions"),
    highlightStore: createStore(`${suffix}-highlights`, "highlights"),
    bookmarkStore: createStore(`${suffix}-bookmarks`, "bookmarks"),
    notebookStore: createStore(`${suffix}-notebooks`, "notebooks"),
    chatSessionStore: createStore(`${suffix}-sessions`, "sessions"),
    activeSessionStore: createStore(`${suffix}-active`, "active"),
  };
  return stores;
}

type Stores = ReturnType<typeof makeStores>;

async function seedBook(stores: Stores, id: string, overrides: Record<string, unknown> = {}) {
  await set(
    id,
    {
      id,
      title: "Test",
      author: "Test",
      coverImage: null,
      format: "epub",
      updatedAt: 100,
      ...overrides,
    },
    stores.bookStore,
  );
}

describe("remapBookId", () => {
  let stores: Stores;
  beforeEach(() => {
    stores = makeStores();
  });

  it("is a no-op when fromId === toId", async () => {
    await seedBook(stores, "b1");
    await remapBookId("b1", "b1", stores);
    const book = await get<Record<string, unknown>>("b1", stores.bookStore);
    expect(book?.deletedAt).toBeUndefined();
  });

  it("moves book data under new id when target has none, and tombstones loser", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    const buf = new ArrayBuffer(16);
    await set("from", buf, stores.bookDataStore);

    await remapBookId("from", "to", stores);

    const toData = await get<ArrayBuffer>("to", stores.bookDataStore);
    const fromData = await get<ArrayBuffer>("from", stores.bookDataStore);
    expect(toData).toBeInstanceOf(ArrayBuffer);
    expect(toData!.byteLength).toBe(16);
    expect(fromData).toBeUndefined();

    const fromBook = await get<Record<string, unknown>>("from", stores.bookStore);
    expect(fromBook?.deletedAt).toBeTypeOf("number");
  });

  it("does not overwrite existing target book data", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set("from", new ArrayBuffer(16), stores.bookDataStore);
    await set("to", new ArrayBuffer(32), stores.bookDataStore);

    await remapBookId("from", "to", stores);

    const toData = await get<ArrayBuffer>("to", stores.bookDataStore);
    expect(toData!.byteLength).toBe(32);
    const fromData = await get<ArrayBuffer>("from", stores.bookDataStore);
    expect(fromData).toBeUndefined();
  });

  it("merges positions with LWW (newer wins)", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set("from", { cfi: "from-cfi", updatedAt: 300 }, stores.positionStore);
    await set("to", { cfi: "to-cfi", updatedAt: 100 }, stores.positionStore);

    await remapBookId("from", "to", stores);

    const toPos = await get<{ cfi: string; updatedAt: number }>("to", stores.positionStore);
    expect(toPos?.cfi).toBe("from-cfi");
    const fromPos = await get("from", stores.positionStore);
    expect(fromPos).toBeUndefined();
  });

  it("rewrites highlight bookId references", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set(
      "h1",
      { id: "h1", bookId: "from", cfiRange: "x", text: "t", color: "y", updatedAt: 1 },
      stores.highlightStore,
    );
    await set(
      "h2",
      { id: "h2", bookId: "other", cfiRange: "x", text: "t", color: "y", updatedAt: 1 },
      stores.highlightStore,
    );

    await remapBookId("from", "to", stores);

    const all = await entries<string, Record<string, unknown>>(stores.highlightStore);
    const byId = new Map(all);
    expect(byId.get("h1")?.bookId).toBe("to");
    expect(byId.get("h2")?.bookId).toBe("other");
  });

  it("merges chat sessions via append-only messages and LWW metadata", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    const fromSessions = [
      {
        id: "s1",
        bookId: "from",
        title: "from-title",
        messages: [
          { id: "m1", role: "user", content: "hi", createdAt: 1 },
          { id: "m2", role: "assistant", content: "hello", createdAt: 2 },
        ],
        createdAt: 1,
        updatedAt: 300,
      },
      {
        id: "s2",
        bookId: "from",
        title: "only-in-from",
        messages: [],
        createdAt: 1,
        updatedAt: 50,
      },
    ];
    const toSessions = [
      {
        id: "s1",
        bookId: "to",
        title: "to-title",
        messages: [{ id: "m0", role: "user", content: "earlier", createdAt: 0 }],
        createdAt: 1,
        updatedAt: 100,
      },
    ];
    await set("from", fromSessions, stores.chatSessionStore);
    await set("to", toSessions, stores.chatSessionStore);

    await remapBookId("from", "to", stores);

    const merged = await get<typeof toSessions>("to", stores.chatSessionStore);
    const byId = new Map(merged!.map((s) => [s.id, s]));
    expect(merged!.length).toBe(2);
    expect(byId.get("s1")!.title).toBe("from-title");
    const s1Msgs = byId
      .get("s1")!
      .messages.map((m) => m.id)
      .sort();
    expect(s1Msgs).toEqual(["m0", "m1", "m2"]);
    expect(byId.get("s2")!.title).toBe("only-in-from");
    const fromChat = await get("from", stores.chatSessionStore);
    expect(fromChat).toBeUndefined();
  });

  it("copies active-session pointer when target lacks one", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set("from", "session-abc", stores.activeSessionStore);

    await remapBookId("from", "to", stores);

    const toActive = await get<string>("to", stores.activeSessionStore);
    expect(toActive).toBe("session-abc");
    const fromActive = await get("from", stores.activeSessionStore);
    expect(fromActive).toBeUndefined();
  });

  it("preserves existing active-session pointer on target", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set("from", "session-from", stores.activeSessionStore);
    await set("to", "session-to", stores.activeSessionStore);

    await remapBookId("from", "to", stores);

    const toActive = await get<string>("to", stores.activeSessionStore);
    expect(toActive).toBe("session-to");
  });

  it("is idempotent — running twice leaves the same final state", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set("from", new ArrayBuffer(8), stores.bookDataStore);
    await set(
      "h1",
      { id: "h1", bookId: "from", cfiRange: "x", text: "t", color: "y", updatedAt: 1 },
      stores.highlightStore,
    );

    await remapBookId("from", "to", stores);
    const afterFirst = await get<Record<string, unknown>>("from", stores.bookStore);
    await remapBookId("from", "to", stores);
    const afterSecond = await get<Record<string, unknown>>("from", stores.bookStore);

    expect(afterFirst?.deletedAt).toBe(afterSecond?.deletedAt);
    const highlight = await get<Record<string, unknown>>("h1", stores.highlightStore);
    expect(highlight?.bookId).toBe("to");
    const fromData = await get("from", stores.bookDataStore);
    expect(fromData).toBeUndefined();
  });

  it("merges notebooks with LWW", async () => {
    await seedBook(stores, "from");
    await seedBook(stores, "to");
    await set(
      "from",
      { bookId: "from", content: { local: true }, updatedAt: 500 },
      stores.notebookStore,
    );
    await set(
      "to",
      { bookId: "to", content: { remote: true }, updatedAt: 200 },
      stores.notebookStore,
    );

    await remapBookId("from", "to", stores);

    const toNotebook = await get<{ bookId: string; content: { local: boolean } }>(
      "to",
      stores.notebookStore,
    );
    expect(toNotebook?.bookId).toBe("to");
    expect(toNotebook?.content).toEqual({ local: true });
    const fromNotebook = await get("from", stores.notebookStore);
    expect(fromNotebook).toBeUndefined();
  });
});
