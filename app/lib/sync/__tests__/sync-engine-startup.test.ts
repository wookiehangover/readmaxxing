import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetUploadBackoff, uploadPendingFiles } from "../file-uploads";
import { pullChanges } from "../pull";
import { pushChanges } from "../push";
import { makeSyncEngine } from "../sync-engine";

vi.mock("../file-uploads", () => ({
  reloadBookFiles: vi.fn(async () => undefined),
  resetUploadBackoff: vi.fn(),
  uploadPendingFiles: vi.fn(async () => undefined),
}));

vi.mock("../pull", () => ({
  pullChanges: vi.fn(async () => undefined),
}));

vi.mock("../push", () => ({
  PUSH_BATCH_SIZE: 50,
  pushChanges: vi.fn(async () => undefined),
}));

const pushChangesMock = vi.mocked(pushChanges);
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
