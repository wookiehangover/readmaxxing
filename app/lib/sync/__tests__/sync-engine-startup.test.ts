import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUnsyncedChanges } from "../change-log";
import { resetUploadBackoff, uploadPendingFiles } from "../file-uploads";
import { pullChanges } from "../pull";
import { pushChanges, pushChangesWithResult, type PushContext } from "../push";
import { makeSyncEngine } from "../sync-engine";

vi.mock("../change-log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../change-log")>()),
  getUnsyncedChanges: vi.fn(async () => []),
}));

vi.mock("../file-uploads", () => ({
  reloadBookFiles: vi.fn(async () => undefined),
  resetUploadBackoff: vi.fn(),
  uploadPendingFiles: vi.fn(async () => undefined),
}));

vi.mock("../pull", () => ({
  pullChanges: vi.fn(async () => undefined),
}));

vi.mock("../push", () => {
  const pushChanges = vi.fn(async (_context: PushContext) => undefined);

  return {
    PUSH_BATCH_SIZE: 50,
    pushChanges,
    pushChangesWithResult: vi.fn(async (context) => {
      await pushChanges(context);
      return null;
    }),
  };
});

const getUnsyncedChangesMock = vi.mocked(getUnsyncedChanges);
const pushChangesMock = vi.mocked(pushChanges);
const pushChangesWithResultMock = vi.mocked(pushChangesWithResult);
const pullChangesMock = vi.mocked(pullChanges);
const resetUploadBackoffMock = vi.mocked(resetUploadBackoff);
const uploadPendingFilesMock = vi.mocked(uploadPendingFiles);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sync-engine startup and manual file recovery", () => {
  it("pushes queued metadata immediately before verified file recovery on startup", async () => {
    const engine = makeSyncEngine({ userId: "user-test" });

    engine.startSync();

    try {
      expect(pushChangesMock).toHaveBeenCalledTimes(1);

      await vi.waitFor(() => {
        expect(uploadPendingFilesMock).toHaveBeenCalledTimes(1);
        expect(pushChangesMock).toHaveBeenCalledTimes(2);
      });

      expect(pullChangesMock).toHaveBeenCalledTimes(1);
      expect(pushChangesMock.mock.invocationCallOrder[0]).toBeLessThan(
        uploadPendingFilesMock.mock.invocationCallOrder[0],
      );
      expect(uploadPendingFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-test" }),
        expect.objectContaining({ verifyExistingRemoteUrls: true }),
      );
      expect(resetUploadBackoffMock).toHaveBeenCalledTimes(1);
    } finally {
      engine.stopSync();
    }
  });

  it("pushes queued metadata before verified file recovery on manual sync", async () => {
    const engine = makeSyncEngine({ userId: "user-test" });

    await engine.triggerManualPush();

    expect(pushChangesMock).toHaveBeenCalledTimes(2);
    expect(uploadPendingFilesMock).toHaveBeenCalledTimes(1);
    expect(pushChangesMock.mock.invocationCallOrder[0]).toBeLessThan(
      uploadPendingFilesMock.mock.invocationCallOrder[0],
    );
    expect(uploadPendingFilesMock.mock.invocationCallOrder[0]).toBeLessThan(
      pushChangesMock.mock.invocationCallOrder[1],
    );
    expect(uploadPendingFilesMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-test" }),
      expect.objectContaining({ verifyExistingRemoteUrls: true }),
    );
    expect(resetUploadBackoffMock).toHaveBeenCalledTimes(1);
  });

  it.each(["startup", "manual"] as const)(
    "retries rejected book metadata without recovering files during %s sync",
    async (recoveryMode) => {
      const rejectedBookChange = {
        id: "rejected-book-change",
        entity: "book" as const,
        entityId: "rejected-book",
        operation: "put" as const,
        data: { id: "rejected-book", title: "Rejected book" },
        timestamp: 1,
        synced: false,
      };

      getUnsyncedChangesMock.mockResolvedValueOnce([rejectedBookChange]);
      pushChangesWithResultMock.mockImplementationOnce(async (context) => {
        await pushChanges(context);
        return {
          accepted: [],
          rejected: [{ id: rejectedBookChange.id, reason: "temporarily unavailable" }],
          serverTimestamp: "2026-08-21T00:00:00.000Z",
        };
      });

      const engine = makeSyncEngine({ userId: "user-test" });

      try {
        if (recoveryMode === "startup") {
          engine.startSync();
          await vi.waitFor(() => expect(pushChangesMock).toHaveBeenCalledTimes(2));
        } else {
          await engine.triggerManualPush();
        }

        expect(resetUploadBackoffMock).not.toHaveBeenCalled();
        expect(uploadPendingFilesMock).not.toHaveBeenCalled();
        expect(pushChangesWithResultMock).toHaveBeenCalledOnce();
        expect(pushChangesMock).toHaveBeenCalledTimes(2);
      } finally {
        engine.stopSync();
      }
    },
  );

  it("recovers files after queued book metadata is accepted", async () => {
    pushChangesWithResultMock.mockImplementationOnce(async (context) => {
      await pushChanges(context);
      return {
        accepted: [{ id: "accepted-book-change" }],
        rejected: [],
        serverTimestamp: "2026-08-21T00:00:00.000Z",
      };
    });

    await makeSyncEngine({ userId: "user-test" }).triggerManualPush();

    expect(getUnsyncedChangesMock).toHaveBeenCalledOnce();
    expect(resetUploadBackoffMock).toHaveBeenCalledOnce();
    expect(uploadPendingFilesMock).toHaveBeenCalledOnce();
    expect(pushChangesMock).toHaveBeenCalledTimes(2);
  });

  it("recovers already-owned book files when unrelated metadata remains pending", async () => {
    getUnsyncedChangesMock.mockResolvedValueOnce([
      {
        id: "rejected-position-change",
        entity: "position",
        entityId: "already-owned-book",
        operation: "put",
        data: { bookId: "already-owned-book", cfi: "epubcfi(/6/2)" },
        timestamp: 1,
        synced: false,
      },
    ]);
    pushChangesWithResultMock.mockImplementationOnce(async (context) => {
      await pushChanges(context);
      return {
        accepted: [],
        rejected: [{ id: "rejected-position-change", reason: "temporarily unavailable" }],
        serverTimestamp: "2026-08-21T00:00:00.000Z",
      };
    });

    await makeSyncEngine({ userId: "user-test" }).triggerManualPush();

    expect(resetUploadBackoffMock).toHaveBeenCalledOnce();
    expect(uploadPendingFilesMock).toHaveBeenCalledOnce();
    expect(pushChangesMock).toHaveBeenCalledTimes(2);
  });

  it("pushes queued metadata even when manual file recovery fails", async () => {
    const recoveryError = new Error("file recovery failed");
    const onSyncError = vi.fn();
    uploadPendingFilesMock.mockRejectedValueOnce(recoveryError);
    const engine = makeSyncEngine({ userId: "user-test", onSyncError });

    await expect(engine.triggerManualPush()).rejects.toThrow("file recovery failed");

    expect(pushChangesMock).toHaveBeenCalledTimes(1);
    expect(pushChangesMock.mock.invocationCallOrder[0]).toBeLessThan(
      uploadPendingFilesMock.mock.invocationCallOrder[0],
    );
    expect(onSyncError).toHaveBeenCalledWith(recoveryError);
  });
});
