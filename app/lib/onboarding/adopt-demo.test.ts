import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, del, entries, get, set } from "idb-keyval";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "./demo-content";
import { hasUnadoptedDemoBook, persistAdoptedDemoContent } from "./adopt-demo";
import { prepareAdoptedDemoContent } from "./adopt-demo-local";
import { getUnsyncedChanges, recordChange, recordPushFailures } from "~/lib/sync/change-log";
import { getBookRemaps } from "~/lib/sync/remap-journal";
import { pushChangesWithResult } from "~/lib/sync/push";
import * as remapRecords from "~/lib/sync/remap-records";
import * as stores from "~/lib/sync/stores";
import type { ChatSession } from "~/lib/stores/chat-store";
import type { ChangeEntry, SyncPushRequest } from "~/lib/sync/types";

const mocks = vi.hoisted(() => ({ chapters: vi.fn() }));
vi.mock("~/lib/sync/file-uploads", () => ({ uploadPendingFiles: async () => {} }));
vi.mock("~/lib/sync/book-chapter-uploads", () => ({ ensureBookChaptersUploaded: mocks.chapters }));

beforeEach(async () => {
  await Promise.all(Object.values(stores).map((store) => clear(store())));
  mocks.chapters.mockReset().mockResolvedValue(undefined);
  await Promise.all([
    set(
      DEMO_BOOK_ID,
      {
        id: DEMO_BOOK_ID,
        title: "The Great Gatsby",
        updatedAt: 100,
        fileHash: "gatsby",
        format: "epub",
      },
      stores.getBookStore(),
    ),
    set(DEMO_BOOK_ID, new Uint8Array([1, 2, 3]).buffer, stores.getBookDataStore()),
    set(
      DEMO_BOOK_ID,
      { bookId: DEMO_BOOK_ID, content: { text: "notes" }, updatedAt: 110 },
      stores.getNotebookStore(),
    ),
    set(DEMO_BOOK_ID, { cfi: "page:12", updatedAt: 120 }, stores.getPositionStore()),
    set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION], stores.getChatSessionStore()),
    set(DEMO_BOOK_ID, DEMO_CHAT_SESSION.id, stores.getActiveSessionStore()),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function acceptingServer(canonicalId?: string) {
  const batches: ChangeEntry[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const { changes } = JSON.parse(init.body) as SyncPushRequest;
      batches.push(changes);
      return Response.json({
        accepted: changes.map((change) => ({
          id: change.id,
          ...(canonicalId && change.entity === "book" ? { canonicalId } : {}),
        })),
        rejected: [],
        serverTimestamp: new Date().toISOString(),
      });
    }),
  );
  return batches;
}

describe("durable demo adoption", () => {
  it.each(["user-session", DEMO_CHAT_SESSION.id, "stale-session"])(
    "adopts remaining conversations when the seeded conversation is gone (active: %s)",
    async (activeSessionId) => {
      const session = { ...DEMO_CHAT_SESSION, id: "user-session", title: "My conversation" };
      await set(DEMO_BOOK_ID, [session], stores.getChatSessionStore());
      await set(DEMO_BOOK_ID, activeSessionId, stores.getActiveSessionStore());
      acceptingServer();
      const adopted = await persistAdoptedDemoContent("reader");
      expect(adopted.sessionId).toBe(session.id);
      expect(await get(adopted.bookId, stores.getChatSessionStore())).toEqual([
        { ...session, bookId: adopted.bookId },
      ]);
      expect(await get(adopted.bookId, stores.getActiveSessionStore())).toBe(session.id);
      expect(await getUnsyncedChanges()).toEqual([]);
    },
  );

  it("preserves an existing root rejection instead of generating an equivalent eligible retry", async () => {
    const book = await get(DEMO_BOOK_ID, stores.getBookStore());
    const root = await recordChange({
      entity: "book",
      entityId: DEMO_BOOK_ID,
      operation: "put",
      data: book,
      timestamp: 100,
    });
    await recordPushFailures([{ id: root.id, reason: "invalid metadata", retryable: false }]);
    await set("malformed-legacy-entry", null, stores.getChangeLogStore());
    const adopted = await prepareAdoptedDemoContent("reader");
    const roots = (await getUnsyncedChanges()).filter((change) => change.entity === "book");
    expect(roots).toHaveLength(1);
    expect(roots[0]).toMatchObject({
      id: root.id,
      entityId: adopted.bookId,
      failure: { retryable: false, attempts: 1 },
    });
  });
  it("delivers late reserved mutations through normal sync using the durable adoption identity", async () => {
    const adopted = await prepareAdoptedDemoContent("reader");
    acceptingServer();
    await persistAdoptedDemoContent("reader");
    const late = await recordChange({
      entity: "chat_session",
      entityId: DEMO_CHAT_SESSION.id,
      operation: "put",
      data: { id: DEMO_CHAT_SESSION.id, bookId: DEMO_BOOK_ID, title: "Late title", updatedAt: 700 },
      timestamp: 700,
    });
    const batches = acceptingServer();
    await pushChangesWithResult({
      fileUploadContext: { userId: "reader", uploadRetryState: new Map() },
      isStopped: () => false,
      scheduleFollowUpPush: () => {},
    });
    expect(batches.flat()).toContainEqual(
      expect.objectContaining({
        id: late.id,
        entityId: adopted.sessionId,
        timestamp: 700,
        data: expect.objectContaining({ bookId: adopted.bookId, title: "Late title" }),
      }),
    );
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("keeps already-owned same-title copies and their data", async () => {
    const existing = { id: "existing-copy", title: "The Great Gatsby", updatedAt: 200 };
    const notes = { bookId: existing.id, content: { text: "My other copy" }, updatedAt: 300 };
    await set(existing.id, existing, stores.getBookStore());
    await set(existing.id, notes, stores.getNotebookStore());
    await prepareAdoptedDemoContent("reader");
    expect(await get(existing.id, stores.getBookStore())).toEqual(existing);
    expect(await get(existing.id, stores.getNotebookStore())).toEqual(notes);
  });
  it("detects only an active unadopted demo", async () => {
    expect(await hasUnadoptedDemoBook()).toBe(true);
    await set(DEMO_BOOK_ID, { id: DEMO_BOOK_ID, deletedAt: 0 }, stores.getBookStore());
    expect(await hasUnadoptedDemoBook()).toBe(false);
    await del(DEMO_BOOK_ID, stores.getBookStore());
    expect(await hasUnadoptedDemoBook()).toBe(false);
  });

  it("pushes original source clocks and retains file data before uploading chapters", async () => {
    const batches = acceptingServer();
    const result = await persistAdoptedDemoContent("reader");
    expect(result.bookId).not.toBe(DEMO_BOOK_ID);
    expect(result.sessionId).not.toBe(DEMO_CHAT_SESSION.id);
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(batches.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: "book", timestamp: 100 }),
        expect.objectContaining({ entity: "notebook", timestamp: 110 }),
        expect.objectContaining({ entity: "position", timestamp: 120 }),
        expect.objectContaining({ entity: "chat_session", timestamp: DEMO_CHAT_SESSION.updatedAt }),
      ]),
    );
    expect(JSON.stringify(batches)).not.toContain(DEMO_BOOK_ID);
    expect(JSON.stringify(batches)).not.toContain(DEMO_CHAT_SESSION.id);
    const data = await get<ArrayBuffer>(result.bookId, stores.getBookDataStore());
    expect(new Uint8Array(data!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(await hasUnadoptedDemoBook()).toBe(false);
    expect(mocks.chapters).toHaveBeenCalledWith(result.bookId);
  });

  it("drains more than 100 unrelated pending edits", async () => {
    for (let index = 0; index < 101; index++)
      await recordChange({
        entity: "notebook",
        entityId: `offline-${index}`,
        operation: "put",
        data: { content: index },
        timestamp: index,
      });
    const batches = acceptingServer();
    await persistAdoptedDemoContent("reader");
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 5]);
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it.each([false, true])(
    "retains rejected entries across retries without resetting backoff (retryable %s)",
    async (retryable) => {
      const fetchMock = vi.fn(async (_url, init) => {
        const { changes } = JSON.parse(init.body) as SyncPushRequest;
        return Response.json({
          accepted: [],
          rejected: changes.map((change) => ({
            id: change.id,
            reason: "server rejected",
            retryable,
          })),
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(persistAdoptedDemoContent("reader")).rejects.toThrow("retained");
      const pending = await getUnsyncedChanges();
      expect(pending.every((change) => change.failure?.retryable === retryable)).toBe(true);
      await expect(persistAdoptedDemoContent("reader")).rejects.toThrow("retained");
      expect(await getUnsyncedChanges()).toEqual(pending);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("recovers the same identity after expired authentication and later relogin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(persistAdoptedDemoContent("reader")).rejects.toThrow();
    const before = await getUnsyncedChanges();
    const bookId = before.find((change) => change.entity === "book")!.entityId;
    const batches = acceptingServer();
    expect((await persistAdoptedDemoContent("reader")).bookId).toBe(bookId);
    expect(batches.flat().map((change) => change.id)).toEqual(before.map((change) => change.id));
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("preserves user sessions, messages, and the active session", async () => {
    const session = {
      id: "user-session",
      bookId: DEMO_BOOK_ID,
      title: "My chat",
      messages: [{ id: "message", role: "user", parts: [{ type: "text", text: "My question" }] }],
      updatedAt: 150,
      createdAt: 140,
    };
    await set(DEMO_BOOK_ID, [DEMO_CHAT_SESSION, session], stores.getChatSessionStore());
    await set(DEMO_BOOK_ID, session.id, stores.getActiveSessionStore());
    acceptingServer();
    const result = await persistAdoptedDemoContent("reader");
    expect(result.sessionId).toBe(session.id);
    expect(await get<ChatSession[]>(result.bookId, stores.getChatSessionStore())).toContainEqual({
      ...session,
      bookId: result.bookId,
    });
  });

  it("uses the remap journal after canonical acceptance followed by chapter failure", async () => {
    await set(
      "canonical",
      { id: "canonical", title: "My newer edition", updatedAt: 200 },
      stores.getBookStore(),
    );
    await set(
      "canonical",
      { bookId: "canonical", content: { text: "newer notes" }, updatedAt: 300 },
      stores.getNotebookStore(),
    );
    acceptingServer("canonical");
    mocks.chapters.mockRejectedValueOnce(new Error("chapter service unavailable"));
    await expect(persistAdoptedDemoContent("reader")).rejects.toThrow("chapter service");
    const journal = await getBookRemaps("reader");
    expect((await persistAdoptedDemoContent("reader")).bookId).toBe("canonical");
    expect(await getBookRemaps("reader")).toEqual(journal);
    expect(await get("canonical", stores.getBookStore())).toMatchObject({
      title: "My newer edition",
      updatedAt: 200,
    });
    expect(await get("canonical", stores.getNotebookStore())).toMatchObject({
      content: { text: "newer notes" },
      updatedAt: 300,
    });
  });

  it("resumes an interrupted local remap without replacing newer adopted notes", async () => {
    const move = remapRecords.moveRemapRecord;
    let interrupted = false;
    vi.spyOn(remapRecords, "moveRemapRecord").mockImplementation(async (...args) => {
      const result = await move(...args);
      if (!interrupted && args[0] === stores.getNotebookStore()) {
        interrupted = true;
        throw new Error("interrupted");
      }
      return result;
    });
    await expect(prepareAdoptedDemoContent("reader")).rejects.toThrow("interrupted");
    const [intent] = await getBookRemaps("reader");
    await set(
      intent.toId,
      { bookId: intent.toId, content: { text: "edited after interruption" }, updatedAt: 500 },
      stores.getNotebookStore(),
    );
    const result = await prepareAdoptedDemoContent("reader");
    expect(result.bookId).toBe(intent.toId);
    expect(await get(result.bookId, stores.getNotebookStore())).toMatchObject({
      content: { text: "edited after interruption" },
      updatedAt: 500,
    });
    expect(await getUnsyncedChanges()).toContainEqual(
      expect.objectContaining({
        entity: "notebook",
        timestamp: 110,
        data: expect.objectContaining({ content: { text: "notes" } }),
      }),
    );
    expect(await entries(stores.getBookStore())).toHaveLength(2);
  });

  it("serializes overlapping preparation and rejects another account without changing ownership", async () => {
    const [first, second] = await Promise.all([
      prepareAdoptedDemoContent("reader"),
      prepareAdoptedDemoContent("reader"),
    ]);
    expect(first).toEqual(second);
    const pending = await getUnsyncedChanges();
    await expect(prepareAdoptedDemoContent("different-reader")).rejects.toThrow("another account");
    expect(await getUnsyncedChanges()).toEqual(pending);
    expect(await entries(stores.getBookStore())).toHaveLength(2);
  });
});
