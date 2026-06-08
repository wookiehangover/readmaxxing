import { describe, it, expect, vi } from "vitest";
import {
  classifyBlobError,
  runUploadWithRetry,
  UPLOAD_INCALL_RETRY_DELAYS_MS,
} from "../upload-retry";

// Construct an Error that mimics the name surface exposed by upload error
// classes. They may be anonymous classes with a patched constructor name, so
// `err.constructor.name === "X"` while `err.name === "Error"`.
function makeBlobError(className: string, message: string): Error {
  class Stub extends Error {}
  Object.defineProperty(Stub, "name", { value: className });
  return new Stub(message);
}

const noSleep = () => Promise.resolve();

describe("classifyBlobError", () => {
  it("classifies access / token errors as auth", () => {
    expect(classifyBlobError(makeBlobError("UploadAccessError", "Upload access denied"))).toBe(
      "auth",
    );
    expect(classifyBlobError(makeBlobError("UploadAccessError", "Upload token expired"))).toBe(
      "auth",
    );
    expect(
      classifyBlobError(
        makeBlobError("UploadPermanentError", "Failed to retrieve the client token"),
      ),
    ).toBe("auth");
  });

  it("classifies service unavailable / rate-limited / unknown as transient", () => {
    expect(
      classifyBlobError(
        makeBlobError("UploadServerError", "The upload service is currently not available."),
      ),
    ).toBe("transient");
    expect(classifyBlobError(makeBlobError("UploadServerError", "Too many requests"))).toBe(
      "transient",
    );
    expect(classifyBlobError(makeBlobError("UploadServerError", "Unknown server error"))).toBe(
      "transient",
    );
  });

  it("treats plain network TypeError as transient", () => {
    expect(classifyBlobError(new TypeError("Failed to fetch"))).toBe("transient");
  });

  it("classifies validation / abort / file-too-large as permanent", () => {
    expect(classifyBlobError(makeBlobError("UploadFileTooLargeError", "too big"))).toBe(
      "permanent",
    );
    expect(classifyBlobError(makeBlobError("UploadContentTypeNotAllowedError", "nope"))).toBe(
      "permanent",
    );
    expect(classifyBlobError(makeBlobError("UploadPermanentError", "aborted"))).toBe("permanent");
  });

  it("classifies non-Error values as permanent", () => {
    expect(classifyBlobError("string error")).toBe("permanent");
    expect(classifyBlobError(null)).toBe("permanent");
    expect(classifyBlobError(undefined)).toBe("permanent");
  });
});

describe("runUploadWithRetry", () => {
  it("returns the result on first success without invoking retry hooks", async () => {
    const performUpload = vi.fn().mockResolvedValue({ url: "https://blob/ok" });
    const onTransientRetry = vi.fn();
    const result = await runUploadWithRetry(performUpload, { onTransientRetry }, [10, 10], noSleep);
    expect(result).toEqual({ url: "https://blob/ok" });
    expect(performUpload).toHaveBeenCalledTimes(1);
    expect(onTransientRetry).not.toHaveBeenCalled();
  });

  it("retries on a 503-style transient error and succeeds on the next attempt", async () => {
    const transient = makeBlobError(
      "UploadServerError",
      "The upload service is currently not available.",
    );
    const performUpload = vi
      .fn<() => Promise<{ url: string }>>()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ url: "https://blob/ok" });
    const onTransientRetry = vi.fn();
    const onGiveUp = vi.fn();

    const result = await runUploadWithRetry(
      performUpload,
      { onTransientRetry, onGiveUp },
      [10, 10],
      noSleep,
    );

    expect(result).toEqual({ url: "https://blob/ok" });
    expect(performUpload).toHaveBeenCalledTimes(2);
    expect(onTransientRetry).toHaveBeenCalledTimes(1);
    expect(onTransientRetry).toHaveBeenCalledWith(1, 10, transient);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("gives up after exhausting all retries on repeated 503s", async () => {
    const transient = makeBlobError("UploadServerError", "unavailable");
    const performUpload = vi.fn<() => Promise<{ url: string }>>().mockRejectedValue(transient);
    const onGiveUp = vi.fn();
    const onTransientRetry = vi.fn();

    // delays = [10, 10] → max 3 attempts total, matching the DoD "503 × 3 → gives up" case.
    const result = await runUploadWithRetry(
      performUpload,
      { onTransientRetry, onGiveUp },
      [10, 10],
      noSleep,
    );

    expect(result).toBeNull();
    expect(performUpload).toHaveBeenCalledTimes(3);
    expect(onTransientRetry).toHaveBeenCalledTimes(2);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(transient, 3);
  });

  it("does not retry on a 403-style auth error and fires onAuthExpired", async () => {
    const authErr = makeBlobError("UploadAccessError", "Upload access denied");
    const performUpload = vi.fn<() => Promise<{ url: string }>>().mockRejectedValue(authErr);
    const onAuthExpired = vi.fn();
    const onTransientRetry = vi.fn();

    const result = await runUploadWithRetry(
      performUpload,
      { onAuthExpired, onTransientRetry },
      [10, 10, 10],
      noSleep,
    );

    expect(result).toBeNull();
    expect(performUpload).toHaveBeenCalledTimes(1);
    expect(onAuthExpired).toHaveBeenCalledTimes(1);
    expect(onTransientRetry).not.toHaveBeenCalled();
  });

  it("does not retry on a permanent 4xx-style error and fires onPermanentFailure", async () => {
    const permErr = makeBlobError("UploadFileTooLargeError", "payload too large");
    const performUpload = vi.fn<() => Promise<{ url: string }>>().mockRejectedValue(permErr);
    const onPermanentFailure = vi.fn();
    const onTransientRetry = vi.fn();

    const result = await runUploadWithRetry(
      performUpload,
      { onPermanentFailure, onTransientRetry },
      [10, 10, 10],
      noSleep,
    );

    expect(result).toBeNull();
    expect(performUpload).toHaveBeenCalledTimes(1);
    expect(onPermanentFailure).toHaveBeenCalledWith(permErr);
    expect(onTransientRetry).not.toHaveBeenCalled();
  });

  it("uses the default 500ms/2s/5s schedule when no delays override is passed", () => {
    expect(UPLOAD_INCALL_RETRY_DELAYS_MS).toEqual([500, 2_000, 5_000]);
  });
});
