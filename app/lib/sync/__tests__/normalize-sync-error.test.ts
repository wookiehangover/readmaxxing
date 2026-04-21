import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSyncError } from "../sync-engine";

describe("normalizeSyncError", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns an Error unchanged when it has a message", () => {
    const err = new Error("Push failed: 500 Internal Server Error");
    expect(normalizeSyncError(err)).toBe(err);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("wraps Error with empty message as Unknown sync error", () => {
    const err = new Error("");
    const result = normalizeSyncError(err);
    expect(result.message).toBe("Unknown sync error");
    expect((result as Error & { cause?: unknown }).cause).toBe(err);
  });

  it("wraps Error with whitespace-only message as Unknown sync error", () => {
    const err = new Error("   ");
    const result = normalizeSyncError(err);
    expect(result.message).toBe("Unknown sync error");
  });

  it("produces Unknown sync error for null", () => {
    const result = normalizeSyncError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("Unknown sync error");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("produces Unknown sync error for undefined", () => {
    const result = normalizeSyncError(undefined);
    expect(result.message).toBe("Unknown sync error");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("produces Unknown sync error for an empty string", () => {
    const result = normalizeSyncError("");
    expect(result.message).toBe("Unknown sync error");
  });

  it("uses the string itself when a non-empty string is thrown", () => {
    const result = normalizeSyncError("boom");
    expect(result.message).toBe("boom");
  });

  it("serializes plain objects via JSON.stringify", () => {
    const result = normalizeSyncError({ status: 500, code: "blob_fetch_failed" });
    expect(result.message).toContain("500");
    expect(result.message).toContain("blob_fetch_failed");
  });

  it("falls back to Unknown sync error for empty objects", () => {
    const result = normalizeSyncError({});
    expect(result.message).toBe("Unknown sync error");
  });

  it("handles objects whose stringification fails (e.g. circular)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = normalizeSyncError(circular);
    expect(result).toBeInstanceOf(Error);
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).not.toBe("null");
    expect(result.message).not.toBe("undefined");
  });
});
