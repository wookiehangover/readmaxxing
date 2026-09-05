import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clear, entries } from "idb-keyval";
import { getUnsyncedChanges, recordChange, recordPushFailures } from "../../change-log";
import { pushChangesWithResult, PUSH_BATCH_SIZE, type PushContext } from "../../push";
import { getBookStore, getChangeLogStore } from "../../stores";
import { makeSyncEngine } from "../../sync-engine";
import type { ChangeEntry, SyncPushRequest } from "../../types";

vi.mock("../../file-uploads", () => ({
  uploadPendingFiles: vi.fn(async () => undefined),
  resetUploadBackoff: vi.fn(),
}));
import { uploadPendingFiles } from "../../file-uploads";

let now: number;
const context = (): PushContext => ({
  fileUploadContext: { userId: "user", uploadRetryState: new Map() },
  isStopped: () => false,
  scheduleFollowUpPush: vi.fn(),
});
const queue = (entityId: string, entity: ChangeEntry["entity"] = "notebook") =>
  recordChange({ entity, entityId, operation: "put", data: { content: entityId }, timestamp: now });

function serverResponse(
  body: SyncPushRequest,
  reject: (entry: ChangeEntry) => boolean,
  retryable?: boolean,
) {
  return Response.json({
    accepted: body.changes.filter((entry) => !reject(entry)).map(({ id }) => ({ id })),
    rejected: body.changes
      .filter(reject)
      .map(({ id }) => ({ id, reason: "injected failure", retryable })),
    serverTimestamp: new Date().toISOString(),
  });
}

beforeEach(async () => {
  await Promise.all([clear(getChangeLogStore()), clear(getBookStore())]);
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(uploadPendingFiles).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable outbox rejection delivery", () => {
  it.each([true, false, undefined])(
    "drains healthy changes behind a full rejected batch (retryable=%s)",
    async (retryable) => {
      const failures = [];
      for (let i = 0; i < PUSH_BATCH_SIZE; i++) failures.push(await queue(`bad-${i}`));
      // ULIDs generated during one millisecond need not follow insertion order.
      now += 1;
      for (let i = 0; i < 12; i++) await queue(`good-${i}`);
      const batches: SyncPushRequest[] = [];
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init!.body as string) as SyncPushRequest;
        batches.push(body);
        return serverResponse(body, (entry) => entry.entityId.startsWith("bad-"), retryable);
      });
      vi.stubGlobal("fetch", fetchMock);
      const onSyncError = vi.fn();
      const onSyncEnd = vi.fn();
      const engine = makeSyncEngine({ userId: "user", onSyncError, onSyncEnd });
      await engine.pushChanges();
      await vi.waitFor(async () => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect((await getUnsyncedChanges()).every((entry) => entry.failure?.attempts === 1)).toBe(
          true,
        );
      });
      expect(batches.map((body) => body.changes.length)).toEqual([50, 12]);
      expect((await getUnsyncedChanges()).map((entry) => entry.id).sort()).toEqual(
        failures.map((entry) => entry.id).sort(),
      );
      expect(onSyncError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("Push incomplete") }),
      );
      expect(onSyncEnd.mock.calls.every(([result]) => !result.success)).toBe(true);
      await engine.pushChanges();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await entries(getChangeLogStore())).toHaveLength(50);
    },
  );

  it.each(["book", "notebook"] as const)(
    "keeps repeated %s failures across module reloads with bounded delays and no attempt limit",
    async (entity) => {
      const original = await queue("persistent-edit", entity);
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
        serverResponse(JSON.parse(init!.body as string), () => true, true),
      );
      vi.stubGlobal("fetch", fetchMock);
      for (let attempt = 1; attempt <= 10; attempt++) {
        vi.resetModules();
        const { pushChangesWithResult: reloadedPush } = await import("../../push");
        await expect(reloadedPush(context())).rejects.toThrow("Push incomplete");
        const [entry] = await getUnsyncedChanges();
        expect(entry).toMatchObject({
          ...original,
          failure: { attempts: attempt, retryable: true },
        });
        const delay = entry.failure!.nextAttemptAt! - now;
        expect(delay).toBeGreaterThanOrEqual(30_000);
        expect(delay).toBeLessThanOrEqual(1_800_000);
        await expect(reloadedPush(context())).rejects.toThrow("Push incomplete");
        expect(fetchMock).toHaveBeenCalledTimes(attempt);
        now = entry.failure!.nextAttemptAt!;
      }
      fetchMock.mockImplementation(async (_url, init) =>
        serverResponse(JSON.parse(init!.body as string), () => false),
      );
      await pushChangesWithResult(context());
      expect(await entries(getChangeLogStore())).toEqual([]);
    },
  );

  it("retains an all-rejected full batch without scheduling immediate retries", async () => {
    for (let i = 0; i < 50; i++) await queue(`bad-${i}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        serverResponse(JSON.parse(init!.body as string), () => true, true),
      ),
    );
    const ctx = context();
    await expect(pushChangesWithResult(ctx)).rejects.toThrow("50 retained");
    expect(ctx.scheduleFollowUpPush).not.toHaveBeenCalled();
    expect(await getUnsyncedChanges()).toHaveLength(50);
  });

  it("preserves new mutations created during a request, even for the same entity", async () => {
    const original = await queue("same-book");
    let concurrent: ChangeEntry;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      concurrent = await recordChange({
        entity: "notebook",
        entityId: "same-book",
        operation: "put",
        data: { content: "newer" },
        timestamp: ++now,
      });
      const body = JSON.parse(init!.body as string) as SyncPushRequest;
      // An acknowledgment outside this request must not delete concurrent work.
      const response = await serverResponse(body, () => false).json();
      response.accepted.push({ id: concurrent.id });
      return Response.json(response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const ctx = context();
    await pushChangesWithResult(ctx);
    expect(await getUnsyncedChanges()).toEqual([concurrent!]);
    expect(concurrent!.id).not.toBe(original.id);
    expect(ctx.scheduleFollowUpPush).toHaveBeenCalledOnce();
  });

  it.each(["network", "503", "unacknowledged"])(
    "retains %s outcomes and waits before another attempt",
    async (outcome) => {
      const change = await queue("unsure");
      const fetchMock = vi.fn(async () => {
        if (outcome === "network") throw new TypeError("Failed to fetch");
        if (outcome === "503") return new Response(null, { status: 503 });
        return Response.json({ accepted: [], rejected: [] });
      });
      vi.stubGlobal("fetch", fetchMock);
      await expect(pushChangesWithResult(context())).rejects.toThrow();
      expect(await getUnsyncedChanges()).toEqual([
        expect.objectContaining({
          ...change,
          failure: expect.objectContaining({ retryable: true, attempts: 1 }),
        }),
      ]);
      await expect(pushChangesWithResult(context())).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("preserves authentication failures, reports failure, and retries after reauthentication", async () => {
    const change = await queue("needs-auth", "book");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const onAuthExpired = vi.fn();
    const onSyncEnd = vi.fn();
    const engine = makeSyncEngine({ userId: "user", onAuthExpired, onSyncEnd });
    await expect(engine.triggerManualPush()).rejects.toThrow("authentication expired");
    expect(await getUnsyncedChanges()).toEqual([change]);
    expect(onAuthExpired).toHaveBeenCalledOnce();
    expect(onSyncEnd).toHaveBeenLastCalledWith({ success: false });
    expect(uploadPendingFiles).not.toHaveBeenCalled();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      serverResponse(JSON.parse(init!.body as string), () => false),
    );
    await engine.triggerManualPush();
    expect(await getUnsyncedChanges()).toEqual([]);
    expect(onSyncEnd).toHaveBeenLastCalledWith({ success: true });
  });
});

it("manual recovery uploads already-owned files while still reporting retained non-book failures", async () => {
  const change = await queue("blocked-notebook");
  await recordPushFailures([{ id: change.id, reason: "unsupported document", retryable: false }]);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const onSyncError = vi.fn();
  const onSyncEnd = vi.fn();
  const engine = makeSyncEngine({ userId: "user", onSyncError, onSyncEnd });
  await expect(engine.triggerManualPush()).rejects.toThrow("unsupported document");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(uploadPendingFiles).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ verifyExistingRemoteUrls: true }),
  );
  expect(onSyncError).toHaveBeenCalledOnce();
  expect(onSyncEnd).toHaveBeenLastCalledWith({ success: false });
});
