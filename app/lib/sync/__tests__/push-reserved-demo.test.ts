import { clear, createStore } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_BOOK_ID, DEMO_CHAT_SESSION } from "~/lib/onboarding/demo-content";
import { getUnsyncedChanges, recordChange } from "../change-log";
import * as fileUploads from "../file-uploads";
import { PUSH_BATCH_SIZE, pushChangesWithResult, type PushContext } from "../push";
import { makeSyncEngine } from "../sync-engine";
import type { ChangeEntry, SyncPushRequest } from "../types";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(async () => ({ url: "blob://unused" })),
}));

const changeLogStore = createStore("ebook-reader-changelog", "changes");
const bookStore = createStore("ebook-reader-db", "books");

beforeEach(async () => {
  await Promise.all([clear(changeLogStore), clear(bookStore)]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeContext(): PushContext {
  return {
    fileUploadContext: { userId: "account-user", uploadRetryState: new Map() },
    isStopped: () => false,
    scheduleFollowUpPush: vi.fn(),
  };
}

function acceptPushedChanges(batches: SyncPushRequest[] = []) {
  const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as SyncPushRequest;
    batches.push(body);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        accepted: body.changes.map((change) => ({ id: change.id })),
        rejected: [],
        serverTimestamp: new Date().toISOString(),
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function queueChange(
  entity: ChangeEntry["entity"],
  entityId: string,
  data: unknown,
): Promise<ChangeEntry> {
  return recordChange({ entity, entityId, operation: "put", data, timestamp: Date.now() });
}

describe("reserved demo metadata push containment", () => {
  it("strips every reserved book/session reference while preserving the canonical adoption batch", async () => {
    const ownedBookId = "owned-gatsby";
    const ownedSessionId = "owned-session";
    await Promise.all([
      queueChange("book", DEMO_BOOK_ID, { id: DEMO_BOOK_ID, title: "The Great Gatsby" }),
      queueChange("position", DEMO_BOOK_ID, { cfi: "epubcfi(/6/2)" }),
      queueChange("notebook", DEMO_BOOK_ID, { bookId: DEMO_BOOK_ID, content: "demo" }),
      queueChange("highlight", "demo-highlight", { bookId: DEMO_BOOK_ID }),
      queueChange("bookmark", "demo-bookmark", { bookId: DEMO_BOOK_ID }),
      queueChange("chat_session", DEMO_CHAT_SESSION.id, { bookId: ownedBookId }),
      queueChange("chat_session", "stale-session", { bookId: DEMO_BOOK_ID }),
      queueChange("chat_message", "stale-message", { sessionId: DEMO_CHAT_SESSION.id }),
      queueChange("book", "mismatched-book", { id: DEMO_BOOK_ID }),
      queueChange("position", "mismatched-position", { bookId: DEMO_BOOK_ID }),
      queueChange("book", ownedBookId, { id: ownedBookId, title: "The Great Gatsby" }),
      queueChange("position", ownedBookId, { cfi: "epubcfi(/6/4)" }),
      queueChange("notebook", ownedBookId, { bookId: ownedBookId, content: "adopted" }),
      queueChange("chat_session", ownedSessionId, {
        id: ownedSessionId,
        bookId: ownedBookId,
      }),
      queueChange("settings", "user-settings", { theme: "dark" }),
    ]);
    const batches: SyncPushRequest[] = [];
    const fetchMock = acceptPushedChanges(batches);
    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);

    const result = await pushChangesWithResult(makeContext());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(batches[0].changes).toHaveLength(5);
    expect(batches[0].changes.map(({ entity, entityId }) => [entity, entityId])).toEqual(
      expect.arrayContaining([
        ["book", ownedBookId],
        ["position", ownedBookId],
        ["notebook", ownedBookId],
        ["chat_session", ownedSessionId],
        ["settings", "user-settings"],
      ]),
    );
    expect(JSON.stringify(batches)).not.toContain(DEMO_BOOK_ID);
    expect(JSON.stringify(batches)).not.toContain(DEMO_CHAT_SESSION.id);
    expect(result?.accepted).toHaveLength(5);
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(uploadSpy).toHaveBeenCalledOnce();
  });

  it("drains a reserved-only queue without a request, upload pass, or follow-up", async () => {
    await Promise.all([
      queueChange("book", DEMO_BOOK_ID, { id: DEMO_BOOK_ID }),
      queueChange("notebook", "stale-notebook", { bookId: DEMO_BOOK_ID }),
      queueChange("chat_session", DEMO_CHAT_SESSION.id, { bookId: "owned-book" }),
    ]);
    const fetchMock = acceptPushedChanges();
    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const context = makeContext();

    await expect(pushChangesWithResult(context)).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(context.scheduleFollowUpPush).not.toHaveBeenCalled();
    expect(await getUnsyncedChanges()).toEqual([]);
  });

  it("removes interspersed reserved entries before draining 101 legitimate changes", async () => {
    const validCount = 101;
    for (let index = 0; index < validCount; index++) {
      if (index % 10 === 0) {
        await queueChange("notebook", DEMO_BOOK_ID, { bookId: DEMO_BOOK_ID, index });
      }
      await queueChange("position", `owned-book-${index}`, { cfi: `cfi-${index}` });
    }
    const batches: SyncPushRequest[] = [];
    const fetchMock = acceptPushedChanges(batches);
    vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const engine = makeSyncEngine({ userId: "account-user" });

    await engine.pushChanges();
    await vi.waitFor(async () => expect(await getUnsyncedChanges()).toEqual([]));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(batches.map(({ changes }) => changes.length)).toEqual([
      PUSH_BATCH_SIZE,
      PUSH_BATCH_SIZE,
      1,
    ]);
    expect(batches.flatMap(({ changes }) => changes)).toHaveLength(validCount);
    expect(JSON.stringify(batches)).not.toContain(DEMO_BOOK_ID);
  });
});
