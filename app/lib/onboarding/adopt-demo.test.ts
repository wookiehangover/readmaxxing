import { beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, set } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import type { ChatSession } from "~/lib/stores/chat-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
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
  getUnsyncedChanges: vi.fn(),
  push: vi.fn(),
  recordChange: vi.fn(),
}));

vi.mock("~/lib/sync/book-chapter-uploads", () => ({
  ensureBookChaptersUploaded: mocks.ensureChapters,
}));
vi.mock("~/lib/sync/change-log", () => ({
  getUnsyncedChanges: mocks.getUnsyncedChanges,
  recordChange: mocks.recordChange,
}));
vi.mock("~/lib/sync/push", () => ({ PUSH_BATCH_SIZE: 50, pushChangesWithResult: mocks.push }));

import { hasUnadoptedDemoBook, persistAdoptedDemoContent } from "./adopt-demo";

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
  mocks.getUnsyncedChanges.mockReset().mockImplementation(async () => recorded.slice(pushedCount));
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
  await WorkspaceService.saveFocusedState({
    order: [DEMO_BOOK_ID],
    activeBookId: DEMO_BOOK_ID,
    clusters: [
      {
        bookId: DEMO_BOOK_ID,
        bookTitle: "The Great Gatsby",
        bookFormat: "epub",
        hasChat: true,
        hasNotebook: true,
        activeTab: "chat",
      },
    ],
  });
});

describe("adoptDemoContent", () => {
  it("detects a locally present demo that has not been adopted", async () => {
    await expect(hasUnadoptedDemoBook()).resolves.toBe(true);
  });

  it("skips a missing or soft-deleted demo", async () => {
    await del(DEMO_BOOK_ID, getBookStore());
    await expect(hasUnadoptedDemoBook()).resolves.toBe(false);

    await set(DEMO_BOOK_ID, { id: DEMO_BOOK_ID, deletedAt: Date.now() }, getBookStore());
    await expect(hasUnadoptedDemoBook()).resolves.toBe(false);
  });

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
    const focusedState = await WorkspaceService.getFocusedState();
    expect(focusedState).toMatchObject({
      order: [ADOPTED_BOOK_ID],
      activeBookId: ADOPTED_BOOK_ID,
      clusters: [{ bookId: ADOPTED_BOOK_ID }],
    });
  });

  it("drains more than one full batch of older changes before the adopted book is accepted", async () => {
    for (let index = 0; index < 101; index++) {
      await mocks.recordChange({
        entity: "notebook",
        entityId: `offline-${index}`,
        operation: "put",
        data: { bookId: `offline-${index}` },
        timestamp: index,
      });
    }
    mocks.push.mockImplementation(async () => {
      const batch = recorded.slice(pushedCount, pushedCount + 50);
      pushedCount += batch.length;
      return {
        accepted: batch.map((entry) => ({ id: entry.id })),
        rejected: [],
        serverTimestamp: new Date().toISOString(),
      } satisfies SyncPushResponse;
    });

    const adopted = await persistAdoptedDemoContent("offline-user");

    expect(adopted).toEqual({ bookId: ADOPTED_BOOK_ID, sessionId: ADOPTED_SESSION_ID });
    expect(mocks.push).toHaveBeenCalledTimes(4);
    expect(mocks.ensureChapters).toHaveBeenCalledWith(ADOPTED_BOOK_ID);
  });

  it("waits across batches for every canonical dependent and session after a book remap", async () => {
    for (let index = 0; index < 49; index++) {
      await mocks.recordChange({
        entity: "notebook",
        entityId: `offline-${index}`,
        operation: "put",
        data: { bookId: `offline-${index}` },
        timestamp: index,
      });
    }
    mocks.push.mockImplementation(async () => {
      const batch = recorded.slice(pushedCount, pushedCount + 50);
      pushedCount += batch.length;
      const accepted = batch.map((entry) => ({
        id: entry.id,
        ...(entry.entity === "book" && entry.entityId === ADOPTED_BOOK_ID
          ? { canonicalId: CANONICAL_BOOK_ID }
          : {}),
      }));
      if (accepted.some((entry) => entry.canonicalId === CANONICAL_BOOK_ID)) {
        await remapBookId(ADOPTED_BOOK_ID, CANONICAL_BOOK_ID);
        for (let index = 0; index < 46; index++) {
          await mocks.recordChange({
            entity: "notebook",
            entityId: `later-offline-${index}`,
            operation: "put",
            data: { bookId: `later-offline-${index}` },
            timestamp: index,
          });
        }
      }
      return { accepted, rejected: [], serverTimestamp: new Date().toISOString() };
    });

    const adopted = await persistAdoptedDemoContent("existing-offline-user");

    expect(adopted).toEqual({ bookId: CANONICAL_BOOK_ID, sessionId: ADOPTED_SESSION_ID });
    const canonicalChanges = recorded.filter(
      (entry) =>
        entry.entityId === CANONICAL_BOOK_ID ||
        (entry.entity === "chat_session" &&
          (entry.data as { bookId: string }).bookId === CANONICAL_BOOK_ID),
    );
    expect(canonicalChanges.map((entry) => entry.entity)).toEqual([
      "book",
      "position",
      "notebook",
      "chat_session",
    ]);
    expect(pushedCount).toBe(recorded.length);
    expect(mocks.push).toHaveBeenCalledTimes(3);
    expect(mocks.ensureChapters).toHaveBeenCalledWith(CANONICAL_BOOK_ID);
  });

  it("fails without retrying when authentication expires during an adoption push", async () => {
    mocks.push.mockResolvedValueOnce(null);

    await expect(persistAdoptedDemoContent("expired-user")).rejects.toThrow(
      "The demo library could not be saved to your account.",
    );

    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.ensureChapters).not.toHaveBeenCalled();
  });

  it("fails immediately when the adopted book is explicitly rejected", async () => {
    mocks.push.mockImplementationOnce(async () => ({
      accepted: [],
      rejected: [{ id: recorded[0].id, reason: "invalid book metadata" }],
      serverTimestamp: new Date().toISOString(),
    }));

    await expect(persistAdoptedDemoContent("rejected-user")).rejects.toThrow(
      "The demo library could not be saved to your account.",
    );

    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.ensureChapters).not.toHaveBeenCalled();
  });

  it("fails when the canonical chat session is explicitly rejected", async () => {
    mocks.push.mockImplementationOnce(async () => acceptedSinceLastPush());
    mocks.push.mockImplementationOnce(async () => {
      const pending = recorded.slice(pushedCount);
      const session = pending.find((entry) => entry.entity === "chat_session");
      expect(session).toBeDefined();
      return {
        accepted: pending.filter((entry) => entry !== session).map((entry) => ({ id: entry.id })),
        rejected: [{ id: session!.id, reason: "session rejected" }],
        serverTimestamp: new Date().toISOString(),
      } satisfies SyncPushResponse;
    });

    await expect(persistAdoptedDemoContent("rejected-session-user")).rejects.toThrow(
      "The demo library could not be saved to your account.",
    );

    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.ensureChapters).not.toHaveBeenCalled();
  });

  it("stops when an older backlog batch makes no changelog progress", async () => {
    await mocks.recordChange({
      entity: "notebook",
      entityId: "stalled-offline-change",
      operation: "put",
      data: {},
      timestamp: 1,
    });
    mocks.push.mockResolvedValue({
      accepted: [],
      rejected: [],
      serverTimestamp: new Date().toISOString(),
    });

    await expect(persistAdoptedDemoContent("stalled-user")).rejects.toThrow(
      "The demo library could not be saved to your account.",
    );

    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.ensureChapters).not.toHaveBeenCalled();
  });

  it("bounds retries when a slowly draining backlog would otherwise starve adoption", async () => {
    for (let index = 0; index < 101; index++) {
      await mocks.recordChange({
        entity: "notebook",
        entityId: `slow-offline-${index}`,
        operation: "put",
        data: {},
        timestamp: index,
      });
    }
    mocks.push.mockImplementation(async () => ({
      accepted: [{ id: recorded[pushedCount++].id }],
      rejected: [],
      serverTimestamp: new Date().toISOString(),
    }));

    await expect(persistAdoptedDemoContent("slow-offline-user")).rejects.toThrow(
      "The demo library could not be saved to your account.",
    );

    expect(mocks.push).toHaveBeenCalledTimes(4);
    expect(mocks.ensureChapters).not.toHaveBeenCalled();
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
    const focusedState = await WorkspaceService.getFocusedState();
    expect(focusedState?.activeBookId).toBe(CANONICAL_BOOK_ID);
  });

  it("removes a reserved session merged into an existing canonical book and repairs its active id", async () => {
    const existingSession = {
      id: "55555555-5555-4555-8555-555555555555",
      bookId: CANONICAL_BOOK_ID,
      title: "Existing account conversation",
      messages: [],
      createdAt: 200,
      updatedAt: 200,
    };
    await Promise.all([
      set(
        CANONICAL_BOOK_ID,
        [{ ...DEMO_CHAT_SESSION, bookId: CANONICAL_BOOK_ID }, existingSession],
        getChatSessionStore(),
      ),
      set(CANONICAL_BOOK_ID, DEMO_CHAT_SESSION.id, getActiveSessionStore()),
    ]);
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
    expect(await get<ChatSession[]>(CANONICAL_BOOK_ID, getChatSessionStore())).toEqual([
      existingSession,
      expect.objectContaining({ id: ADOPTED_SESSION_ID, bookId: CANONICAL_BOOK_ID }),
    ]);
    expect(await get(CANONICAL_BOOK_ID, getActiveSessionStore())).toBe(ADOPTED_SESSION_ID);
    expect(recorded.some((entry) => entry.entityId === DEMO_CHAT_SESSION.id)).toBe(false);
  });
});
