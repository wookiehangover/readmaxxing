import { describe, it, expect } from "vitest";
import {
  UPLOAD_BACKOFF_SCHEDULE_MS,
  clearUploadRetry,
  getUploadRetryDelayMs,
  recordUploadFailure,
  shouldAttemptUpload,
  uploadRetryKey,
  type UploadRetryEntry,
} from "../upload-retry";

describe("uploadRetryKey", () => {
  it("composes bookId and type", () => {
    expect(uploadRetryKey("book-1", "file")).toBe("book-1:file");
    expect(uploadRetryKey("book-1", "cover")).toBe("book-1:cover");
  });
});

describe("getUploadRetryDelayMs", () => {
  it("returns the scheduled delay for each attempt", () => {
    expect(getUploadRetryDelayMs(1)).toBe(UPLOAD_BACKOFF_SCHEDULE_MS[0]);
    expect(getUploadRetryDelayMs(2)).toBe(UPLOAD_BACKOFF_SCHEDULE_MS[1]);
    expect(getUploadRetryDelayMs(5)).toBe(UPLOAD_BACKOFF_SCHEDULE_MS[4]);
  });

  it("caps at the final schedule entry for attempts beyond the schedule", () => {
    const last = UPLOAD_BACKOFF_SCHEDULE_MS[UPLOAD_BACKOFF_SCHEDULE_MS.length - 1];
    expect(getUploadRetryDelayMs(10)).toBe(last);
    expect(getUploadRetryDelayMs(100)).toBe(last);
  });

  it("treats non-positive attempts as the first-failure delay", () => {
    expect(getUploadRetryDelayMs(0)).toBe(UPLOAD_BACKOFF_SCHEDULE_MS[0]);
  });
});

describe("shouldAttemptUpload", () => {
  it("returns attempt=true when there is no prior failure", () => {
    const state = new Map<string, UploadRetryEntry>();
    expect(shouldAttemptUpload(state, "book-1:file", 1000)).toEqual({ attempt: true });
  });

  it("blocks attempts inside the active backoff window", () => {
    const state = new Map<string, UploadRetryEntry>();
    state.set("book-1:file", { attempts: 1, nextRetryAt: 5000 });
    expect(shouldAttemptUpload(state, "book-1:file", 4000)).toEqual({
      attempt: false,
      retryInMs: 1000,
    });
  });

  it("allows attempts once the backoff window has elapsed", () => {
    const state = new Map<string, UploadRetryEntry>();
    state.set("book-1:file", { attempts: 1, nextRetryAt: 5000 });
    expect(shouldAttemptUpload(state, "book-1:file", 5000)).toEqual({ attempt: true });
    expect(shouldAttemptUpload(state, "book-1:file", 6000)).toEqual({ attempt: true });
  });

  it("tracks file and cover separately for the same book", () => {
    const state = new Map<string, UploadRetryEntry>();
    state.set("book-1:file", { attempts: 1, nextRetryAt: 5000 });
    expect(shouldAttemptUpload(state, "book-1:cover", 1000)).toEqual({ attempt: true });
  });
});

describe("recordUploadFailure", () => {
  it("schedules the first retry using the first backoff slot", () => {
    const state = new Map<string, UploadRetryEntry>();
    const entry = recordUploadFailure(state, "book-1:file", 1000);
    expect(entry.attempts).toBe(1);
    expect(entry.nextRetryAt).toBe(1000 + UPLOAD_BACKOFF_SCHEDULE_MS[0]);
    expect(state.get("book-1:file")).toBe(entry);
  });

  it("increments attempts and advances through the schedule on repeated failures", () => {
    const state = new Map<string, UploadRetryEntry>();
    recordUploadFailure(state, "book-1:file", 0);
    recordUploadFailure(state, "book-1:file", 100);
    const third = recordUploadFailure(state, "book-1:file", 200);
    expect(third.attempts).toBe(3);
    expect(third.nextRetryAt).toBe(200 + UPLOAD_BACKOFF_SCHEDULE_MS[2]);
  });

  it("caps at the final schedule slot after exhausting the schedule", () => {
    const state = new Map<string, UploadRetryEntry>();
    for (let i = 0; i < UPLOAD_BACKOFF_SCHEDULE_MS.length + 3; i++) {
      recordUploadFailure(state, "book-1:file", 0);
    }
    const last = UPLOAD_BACKOFF_SCHEDULE_MS[UPLOAD_BACKOFF_SCHEDULE_MS.length - 1];
    expect(state.get("book-1:file")?.nextRetryAt).toBe(last);
  });
});

describe("clearUploadRetry", () => {
  it("removes the entry so the next attempt is allowed immediately", () => {
    const state = new Map<string, UploadRetryEntry>();
    recordUploadFailure(state, "book-1:file", 1000);
    clearUploadRetry(state, "book-1:file");
    expect(state.has("book-1:file")).toBe(false);
    expect(shouldAttemptUpload(state, "book-1:file", 1001)).toEqual({ attempt: true });
  });

  it("is a no-op when no entry exists", () => {
    const state = new Map<string, UploadRetryEntry>();
    expect(() => clearUploadRetry(state, "book-1:file")).not.toThrow();
  });
});

describe("backoff lifecycle", () => {
  it("first failure schedules retry, second call within window is a no-op, call after window retries, success clears state", () => {
    const state = new Map<string, UploadRetryEntry>();
    const key = uploadRetryKey("book-1", "file");

    // 1) First attempt: allowed.
    expect(shouldAttemptUpload(state, key, 0)).toEqual({ attempt: true });

    // Upload fails.
    const firstFailure = recordUploadFailure(state, key, 0);
    expect(firstFailure.attempts).toBe(1);
    expect(firstFailure.nextRetryAt).toBe(UPLOAD_BACKOFF_SCHEDULE_MS[0]);

    // 2) Second call inside the window is blocked.
    const blocked = shouldAttemptUpload(state, key, UPLOAD_BACKOFF_SCHEDULE_MS[0] - 1);
    expect(blocked).toEqual({ attempt: false, retryInMs: 1 });

    // 3) Call after the window is allowed.
    expect(shouldAttemptUpload(state, key, UPLOAD_BACKOFF_SCHEDULE_MS[0])).toEqual({
      attempt: true,
    });

    // That retry fails too — backoff advances.
    const secondFailure = recordUploadFailure(state, key, UPLOAD_BACKOFF_SCHEDULE_MS[0]);
    expect(secondFailure.attempts).toBe(2);
    expect(secondFailure.nextRetryAt).toBe(
      UPLOAD_BACKOFF_SCHEDULE_MS[0] + UPLOAD_BACKOFF_SCHEDULE_MS[1],
    );

    // 4) Eventually it succeeds — state clears.
    clearUploadRetry(state, key);
    expect(state.has(key)).toBe(false);
    expect(shouldAttemptUpload(state, key, 0)).toEqual({ attempt: true });
  });
});
