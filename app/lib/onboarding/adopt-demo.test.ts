import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, set } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import type { ChatSession } from "~/lib/stores/chat-store";
import type { ChangeEntry, SyncPushResponse } from "~/lib/sync/types";
import { remapBookId } from "~/lib/sync/remap";
import {
  getActiveSessionStore,
  getBookDataStore,
  getBookStore,
  getChatSessionStore,
  getNotebookStore,
  getPositionStore,
} from "~/lib/sync/stores";

const mocks = vi.hoisted(() => ({
  ensureChapters: vi.fn(),
  push: vi.fn(),
  recordChange: vi.fn(),
}));

vi.mock("~/lib/sync/book-chapter-uploads", () => ({
  ensureBookChaptersUploaded: mocks.ensureChapters,
}));
vi.mock("~/lib/sync/change-log", () => ({ recordChange: mocks.recordChange }));
vi.mock("~/lib/sync/push", () => ({ pushChangesWithResult: mocks.push }));

import { persistAdoptedDemoContent } from "./adopt-demo";

const CANONICAL_BOOK_ID = "11111111-1111-4111-8111-111111111111";
const ADOPTED_BOOK_ID = "33333333-3333-4333-8333-333333333333";
const ADOPTED_SESSION_ID = "22222222-2222-4222-8222-222222222222";
let recorded: ChangeEntry[];
let pushedCount: number;

function acceptedSinceLastPush(canonicalId?: string): SyncPushResponse {
  const pending = recorded.slice(pushedCount);
  pushedCount = recorded.length;
  return {
    accepted: pending.map((entry) => ({
      id: entry.id,
      ...(canonicalId && entry.entity === "book" ? { canonicalId } : {}),
    })),
    rejected: [],
    serverTimestamp: new Date().toISOString(),
  };
}

beforeEach(async () => {
  recorded = [];
  pushedCount = 0;
  mocks.ensureChapters.mockReset().mockResolvedValue(undefined);
  mocks.push.mockReset();
  mocks.recordChange.mockReset().mockImplementation(async (entry) => {
    const change = { ...entry, id: `change-${recorded.length + 1}`, synced: false } as ChangeEntry;
    recorded.push(change);
    return change;
  });
  vi.spyOn(crypto, "randomUUID")
    .mockReturnValueOnce(ADOPTED_BOOK_ID)
    .mockReturnValueOnce(ADOPTED_SESSION_ID);

  await Promise.all(
    [DEMO_BOOK_ID, ADOPTED_BOOK_ID, CANONICAL_BOOK_ID].flatMap((bookId) => [
      del(bookId, getBookStore()),
      del(bookId, getBookDataStore()),
      del(bookId, getPositionStore()),
      del(bookId, getNotebookStore()),
      del(bookId, getChatSessionStore()),
      del(bookId, getActiveSessionStore()),
    ]),
  );
  await Promise.all([
    set(
      DEMO_BOOK_ID,
      {
        id: DEMO_BOOK_ID,
        title: "The Great Gatsby",
        author: "F. Scott Fitzgerald",
        coverImage: null,
        format: "epub",
        fileHash: "gatsby-hash",
        updatedAt: 100,
      },
      getBookStore(),
    ),
    set(DEMO_BOOK_ID, new ArrayBuffer(8), getBookDataStore()),
    set(DEMO_BOOK_ID, { cfi: "epubcfi(/6/2)", updatedAt: 101 }, getPositionStore()),
    set(
      DEMO_BOOK_ID,
      { bookId: DEMO_BOOK_ID, content: { type: "doc" }, updatedAt: 102 },
      getNotebookStore(),
    ),
    set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION], getChatSessionStore()),
    set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, getActiveSessionStore()),
  ]);
});

describe("adoptDemoContent", () => {
  it("records and pushes seeded data before uploading chapters", async () => {
    const order: string[] = [];
    mocks.push.mockImplementation(async () => {
      order.push("push");
      return acceptedSinceLastPush();
    });
    mocks.ensureChapters.mockImplementation(async () => {
      order.push("chapters");
    });

    const adopted = await persistAdoptedDemoContent("user-1");

    expect(adopted).toEqual({ bookId: ADOPTED_BOOK_ID, sessionId: ADOPTED_SESSION_ID });
    expect(order).toEqual(["push", "push", "chapters"]);
    expect(recorded.filter((entry) => entry.entity === "chat_session")).toHaveLength(2);
    expect(await get(ADOPTED_BOOK_ID, getActiveSessionStore())).toBe(ADOPTED_SESSION_ID);
    const sessions = await get<ChatSession[]>(ADOPTED_BOOK_ID, getChatSessionStore());
    expect(sessions?.find((session) => session.id === ADOPTED_SESSION_ID)?.messages).toEqual([]);
    expect(recorded[0]).toMatchObject({ entity: "book", entityId: ADOPTED_BOOK_ID });
    expect(await get<Record<string, unknown>>(DEMO_BOOK_ID, getBookStore())).toHaveProperty(
      "deletedAt",
    );
  });

  it("mints a fresh id for the demo session when a user chat already exists", async () => {
    const USER_SESSION_ID = "44444444-4444-4444-8444-444444444444";
    const userSession = {
      id: USER_SESSION_ID,
      bookId: DEMO_BOOK_ID,
      title: "My own chat",
      messages: [],
      createdAt: 200,
      updatedAt: 200,
    };
    await Promise.all([
      set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION, userSession], getChatSessionStore()),
      set(DEMO_BOOK_ID, USER_SESSION_ID, getActiveSessionStore()),
    ]);
    mocks.push.mockImplementation(async () => acceptedSinceLastPush());

    const adopted = await persistAdoptedDemoContent("user-2");

    expect(adopted.sessionId).toBe(USER_SESSION_ID);
    const savedSessions = await get<{ id: string; bookId: string }[]>(
      ADOPTED_BOOK_ID,
      getChatSessionStore(),
    );
    const ids = savedSessions?.map((session) => session.id) ?? [];
    expect(ids).toContain(USER_SESSION_ID);
    expect(ids).toContain(ADOPTED_SESSION_ID);
    expect(ids).not.toContain(DEMO_CHAT_SESSION.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sessionChanges = recorded.filter((entry) => entry.entity === "chat_session");
    const changeIds = sessionChanges.map((entry) => entry.entityId);
    // Two sessions × two push cycles (initial + canonical) = 4 change entries,
    // and none should reuse the demo session id or collide within a cycle.
    expect(sessionChanges).toHaveLength(4);
    expect(changeIds).not.toContain(DEMO_CHAT_SESSION.id);
    const uniquePerSession = changeIds.filter((id) => id === ADOPTED_SESSION_ID);
    expect(uniquePerSession).toHaveLength(2);
    const uniquePerUser = changeIds.filter((id) => id === USER_SESSION_ID);
    expect(uniquePerUser).toHaveLength(2);
    expect(await get(ADOPTED_BOOK_ID, getActiveSessionStore())).toBe(USER_SESSION_ID);
  });

  it("re-records dependents under a server-deduplicated canonical book id", async () => {
    mocks.push.mockImplementation(async () => {
      if (pushedCount === 0) {
        const response = acceptedSinceLastPush(CANONICAL_BOOK_ID);
        await remapBookId(ADOPTED_BOOK_ID, CANONICAL_BOOK_ID);
        return response;
      }
      return acceptedSinceLastPush();
    });

    const adopted = await persistAdoptedDemoContent("existing-user");

    expect(adopted).toEqual({ bookId: CANONICAL_BOOK_ID, sessionId: ADOPTED_SESSION_ID });
    expect(mocks.ensureChapters).toHaveBeenCalledWith(CANONICAL_BOOK_ID);
    const finalSessionChange = recorded.filter((entry) => entry.entity === "chat_session").at(-1);
    expect(finalSessionChange?.data).toMatchObject({ bookId: CANONICAL_BOOK_ID });
  });
});
