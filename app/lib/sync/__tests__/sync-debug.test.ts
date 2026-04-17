import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isSyncDebugEnabled, syncDebugLog } from "../sync-debug";

describe("isSyncDebugEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns false when the flag is unset", () => {
    expect(isSyncDebugEnabled()).toBe(false);
  });

  it("returns true only when the flag is exactly '1'", () => {
    localStorage.setItem("sync_debug", "1");
    expect(isSyncDebugEnabled()).toBe(true);
  });

  it("returns false for other truthy-looking values", () => {
    localStorage.setItem("sync_debug", "true");
    expect(isSyncDebugEnabled()).toBe(false);
    localStorage.setItem("sync_debug", "0");
    expect(isSyncDebugEnabled()).toBe(false);
    localStorage.setItem("sync_debug", "");
    expect(isSyncDebugEnabled()).toBe(false);
  });

  it("returns false when localStorage access throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(isSyncDebugEnabled()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("syncDebugLog", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("does nothing when the flag is off", () => {
    syncDebugLog("upload-attempt", { bookId: "b1" });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs with a [sync-debug] prefix and payload when the flag is on", () => {
    localStorage.setItem("sync_debug", "1");
    syncDebugLog("upload-attempt", { bookId: "b1", type: "file", size: 1024 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[sync-debug] upload-attempt", {
      bookId: "b1",
      type: "file",
      size: 1024,
    });
  });

  it("logs without payload when none is provided", () => {
    localStorage.setItem("sync_debug", "1");
    syncDebugLog("pull-start");
    expect(logSpy).toHaveBeenCalledWith("[sync-debug] pull-start");
  });
});
