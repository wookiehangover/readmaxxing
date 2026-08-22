import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore, clear } from "idb-keyval";
import { recordChange, getUnsyncedChanges } from "../change-log";
import * as fileUploads from "../file-uploads";
import { pushChangesWithResult } from "../push";
import { makeSyncEngine, PUSH_BATCH_SIZE } from "../sync-engine";
import type { SyncPushRequest } from "../types";

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

describe("pushChanges batching", () => {
  it("exports PUSH_BATCH_SIZE = 50", () => {
    expect(PUSH_BATCH_SIZE).toBe(50);
  });

  it("splits 150 pending changes into three 50-entry batches, drains all, and marks them synced", async () => {
    for (let i = 0; i < 150; i++) {
      await recordChange({
        entity: "position",
        entityId: `book-${i.toString().padStart(3, "0")}`,
        operation: "put",
        data: { cfi: `cfi-${i}`, updatedAt: i },
        timestamp: i,
      });
    }

    const batches: SyncPushRequest[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      batches.push(body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes.map((c) => ({ id: c.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pushChanges();

    // Follow-up pushes are scheduled via queueMicrotask. Poll until the
    // changelog drains, bounded so a bug can't hang the suite.
    for (let i = 0; i < 50; i++) {
      const remaining = await getUnsyncedChanges();
      if (remaining.length === 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(batches).toHaveLength(3);
    expect(batches[0].changes).toHaveLength(50);
    expect(batches[1].changes).toHaveLength(50);
    expect(batches[2].changes).toHaveLength(50);

    // Batches are sent in chronological ULID order across the whole run.
    const sentIds = batches.flatMap((b) => b.changes.map((c) => c.id));
    const sortedSentIds = [...sentIds].sort((a, b) => a.localeCompare(b));
    expect(sentIds).toEqual(sortedSentIds);
    expect(new Set(sentIds).size).toBe(150);

    // Every entry is marked synced (and thus cleared) after the drain.
    expect(await getUnsyncedChanges()).toHaveLength(0);
  });

  it("drains rejected entries from the changelog and logs their reasons", async () => {
    for (let i = 0; i < 5; i++) {
      await recordChange({
        entity: "position",
        entityId: `book-${i}`,
        operation: "put",
        data: { cfi: `cfi-${i}`, updatedAt: i },
        timestamp: i,
      });
    }

    const pendingBefore = await getUnsyncedChanges();
    expect(pendingBefore).toHaveLength(5);
    // Reject the first two entries; accept the rest.
    const rejectIds = pendingBefore.slice(0, 2).map((c) => c.id);
    const acceptIds = pendingBefore.slice(2).map((c) => c.id);

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: acceptIds.map((id) => ({ id })),
          rejected: rejectIds.map((id) => ({ id, reason: "stale-entity" })),
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pushChanges();

    // Rejected entries must not re-appear on the next getUnsyncedChanges
    // (i.e. they drained from the changelog) and must not be re-sent on a
    // follow-up push.
    expect(await getUnsyncedChanges()).toHaveLength(0);

    fetchMock.mockClear();
    await engine.pushChanges();
    expect(fetchMock).not.toHaveBeenCalled();

    // Each rejection was logged with its reason.
    expect(warnSpy).toHaveBeenCalledTimes(rejectIds.length);
    for (const id of rejectIds) {
      expect(warnSpy).toHaveBeenCalledWith(expect.any(String), id, "stale-entity");
    }

    warnSpy.mockRestore();
  });

  it("keeps a rejected book upsert queued while unrelated accepted entries drain, then retries it", async () => {
    const bookChange = await recordChange({
      entity: "book",
      entityId: "book-needs-retry",
      operation: "put",
      data: { id: "book-needs-retry", title: "Recoverable book" },
      timestamp: 1,
    });
    const positionChange = await recordChange({
      entity: "position",
      entityId: "unrelated-book",
      operation: "put",
      data: { bookId: "unrelated-book", cfi: "epubcfi(/6/2)", updatedAt: 2 },
      timestamp: 2,
    });

    const sentBatches: SyncPushRequest[] = [];
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      sentBatches.push(body);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted:
            sentBatches.length === 1 ? [{ id: positionChange.id }] : [{ id: bookChange.id }],
          rejected:
            sentBatches.length === 1
              ? [{ id: bookChange.id, reason: "database connection temporarily unavailable" }]
              : [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const engine = makeSyncEngine({ userId: "user-test" });

    await engine.pushChanges();

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(await getUnsyncedChanges()).toEqual([expect.objectContaining({ id: bookChange.id })]);
    expect(sentBatches[0].changes.map((change) => change.id)).toEqual(
      expect.arrayContaining([bookChange.id, positionChange.id]),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Book"),
      bookChange.id,
      bookChange.entityId,
      "database connection temporarily unavailable",
    );

    await engine.pushChanges();

    expect(sentBatches).toHaveLength(2);
    expect(sentBatches[1].changes).toEqual([expect.objectContaining({ id: bookChange.id })]);
    expect(await getUnsyncedChanges()).toHaveLength(0);
    expect(uploadSpy).toHaveBeenCalledOnce();

    uploadSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("drains a permanently rejected book after bounded retries without blocking unrelated changes", async () => {
    const bookChange = await recordChange({
      entity: "book",
      entityId: "permanently-invalid-book",
      operation: "put",
      data: { id: "permanently-invalid-book", title: "Invalid book" },
      timestamp: 1,
    });
    const positionChange = await recordChange({
      entity: "position",
      entityId: "unrelated-book",
      operation: "put",
      data: { bookId: "unrelated-book", cfi: "epubcfi(/6/2)", updatedAt: 2 },
      timestamp: 2,
    });

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes
            .filter((change) => change.id !== bookChange.id)
            .map((change) => ({ id: change.id })),
          rejected: [{ id: bookChange.id, reason: "invalid book metadata" }],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const engine = makeSyncEngine({ userId: "user-test" });

    await engine.pushChanges();
    expect(await getUnsyncedChanges()).toEqual([expect.objectContaining({ id: bookChange.id })]);
    expect(fetchMock.mock.calls[0][1]?.body).toContain(positionChange.id);

    await engine.pushChanges();
    expect(await getUnsyncedChanges()).toEqual([expect.objectContaining({ id: bookChange.id })]);

    await engine.pushChanges();
    expect(await getUnsyncedChanges()).toHaveLength(0);

    await engine.pushChanges();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(uploadSpy).not.toHaveBeenCalled();

    uploadSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("waits to upload until book metadata queued beyond the current batch is accepted", async () => {
    for (let i = 0; i < PUSH_BATCH_SIZE; i++) {
      await recordChange({
        entity: "position",
        entityId: `book-${i}`,
        operation: "put",
        data: { cfi: `cfi-${i}`, updatedAt: i },
        timestamp: i,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    const bookChange = await recordChange({
      entity: "book",
      entityId: "book-in-next-batch",
      operation: "put",
      data: { id: "book-in-next-batch", title: "Queued book" },
      timestamp: PUSH_BATCH_SIZE,
    });

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes.map((change) => ({ id: change.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const scheduleFollowUpPush = vi.fn();
    const context = {
      fileUploadContext: { userId: "user-test", uploadRetryState: new Map() },
      isStopped: () => false,
      scheduleFollowUpPush,
    };

    await pushChangesWithResult(context);

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(scheduleFollowUpPush).toHaveBeenCalledOnce();
    expect(await getUnsyncedChanges()).toEqual([expect.objectContaining({ id: bookChange.id })]);

    await pushChangesWithResult(context);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(uploadSpy).toHaveBeenCalledOnce();
    expect(await getUnsyncedChanges()).toHaveLength(0);

    uploadSpy.mockRestore();
  });

  it("still uploads pending files after accepted changes for already-owned books", async () => {
    await recordChange({
      entity: "position",
      entityId: "already-owned-book",
      operation: "put",
      data: { bookId: "already-owned-book", cfi: "epubcfi(/6/2)", updatedAt: 1 },
      timestamp: 1,
    });

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes.map((change) => ({ id: change.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const uploadSpy = vi.spyOn(fileUploads, "uploadPendingFiles").mockResolvedValue(undefined);
    const engine = makeSyncEngine({ userId: "user-test" });

    await engine.pushChanges();

    expect(uploadSpy).toHaveBeenCalledOnce();
    expect(uploadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-test" }),
      expect.objectContaining({ isStopped: expect.any(Function) }),
    );

    uploadSpy.mockRestore();
  });

  it("does not schedule a follow-up push when the batch was not full", async () => {
    for (let i = 0; i < 10; i++) {
      await recordChange({
        entity: "position",
        entityId: `book-${i}`,
        operation: "put",
        data: { cfi: `cfi-${i}`, updatedAt: i },
        timestamp: i,
      });
    }

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as SyncPushRequest;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          accepted: body.changes.map((c) => ({ id: c.id })),
          rejected: [],
          serverTimestamp: new Date().toISOString(),
        }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = makeSyncEngine({ userId: "user-test" });
    await engine.pushChanges();

    // Give any (incorrectly) scheduled follow-ups a chance to fire.
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getUnsyncedChanges()).toHaveLength(0);
  });
});
