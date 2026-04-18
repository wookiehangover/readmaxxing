import { describe, it, expect, vi } from "vitest";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";

describe("resolveStartCfi", () => {
  it("returns latestCfi when provided (skips all DB calls)", async () => {
    const getPosition = vi.fn<(key: string) => Promise<string | null>>();

    const result = await resolveStartCfi({
      latestCfi: "epubcfi(/6/10)",
      panelId: "panel-1",
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBe("epubcfi(/6/10)");
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("returns panel-specific position when latestCfi is null and panelId position exists", async () => {
    const getPosition = vi
      .fn<(key: string) => Promise<string | null>>()
      .mockImplementation(async (key) => (key === "panel-1" ? "epubcfi(/6/20)" : null));

    const result = await resolveStartCfi({
      latestCfi: null,
      panelId: "panel-1",
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBe("epubcfi(/6/20)");
    expect(getPosition).toHaveBeenCalledWith("panel-1");
    // Should NOT fall through to bookId lookup
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("falls back to bookId position when panelId position is null", async () => {
    const getPosition = vi
      .fn<(key: string) => Promise<string | null>>()
      .mockImplementation(async (key) => (key === "book-1" ? "epubcfi(/6/30)" : null));

    const result = await resolveStartCfi({
      latestCfi: null,
      panelId: "panel-1",
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBe("epubcfi(/6/30)");
    expect(getPosition).toHaveBeenCalledWith("panel-1");
    expect(getPosition).toHaveBeenCalledWith("book-1");
    expect(getPosition).toHaveBeenCalledTimes(2);
  });

  it("returns null when nothing is found", async () => {
    const getPosition = vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null);

    const result = await resolveStartCfi({
      latestCfi: null,
      panelId: "panel-1",
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBeNull();
    expect(getPosition).toHaveBeenCalledTimes(2);
  });

  it("skips panelId lookup when panelId is undefined", async () => {
    const getPosition = vi
      .fn<(key: string) => Promise<string | null>>()
      .mockImplementation(async (key) => (key === "book-1" ? "epubcfi(/6/40)" : null));

    const result = await resolveStartCfi({
      latestCfi: null,
      panelId: undefined,
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBe("epubcfi(/6/40)");
    // Only bookId lookup, no panelId lookup
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(getPosition).toHaveBeenCalledWith("book-1");
  });

  it("returns null when panelId is undefined and bookId has no position", async () => {
    const getPosition = vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null);

    const result = await resolveStartCfi({
      latestCfi: null,
      panelId: undefined,
      bookId: "book-1",
      getPosition,
    });

    expect(result).toBeNull();
    expect(getPosition).toHaveBeenCalledTimes(1);
  });
});

describe("savePositionDualKey", () => {
  it("saves to both panelId and bookId keys", async () => {
    const savePosition = vi
      .fn<(key: string, cfi: string, options?: { recordChange?: boolean }) => Promise<void>>()
      .mockResolvedValue(undefined);

    await savePositionDualKey({
      panelId: "panel-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/50)",
      savePosition,
    });

    expect(savePosition).toHaveBeenCalledTimes(2);
    expect(savePosition).toHaveBeenNthCalledWith(1, "book-1", "epubcfi(/6/50)");
    expect(savePosition).toHaveBeenNthCalledWith(2, "panel-1", "epubcfi(/6/50)", {
      recordChange: false,
    });
  });

  it("emits exactly one sync-recording save per page turn (bookId only, panel-key is local-only)", async () => {
    const recording: string[] = [];
    const savePosition = vi
      .fn<(key: string, cfi: string, options?: { recordChange?: boolean }) => Promise<void>>()
      .mockImplementation(async (key, _cfi, options) => {
        if (options?.recordChange !== false) recording.push(key);
      });

    await savePositionDualKey({
      panelId: "panel-42",
      bookId: "book-42",
      cfi: "epubcfi(/6/80)",
      savePosition,
    });

    // Regression guard: without the recordChange:false flag on the panel save,
    // a single page turn in workspace mode produced two sync changelog entries.
    expect(recording).toEqual(["book-42"]);
  });

  it("saves only to bookId when panelId is undefined", async () => {
    const savePosition = vi
      .fn<(key: string, cfi: string, options?: { recordChange?: boolean }) => Promise<void>>()
      .mockResolvedValue(undefined);

    await savePositionDualKey({
      panelId: undefined,
      bookId: "book-1",
      cfi: "epubcfi(/6/60)",
      savePosition,
    });

    expect(savePosition).toHaveBeenCalledTimes(1);
    expect(savePosition).toHaveBeenCalledWith("book-1", "epubcfi(/6/60)");
  });

  it("both saves receive the same CFI value", async () => {
    const saved: Array<{ key: string; cfi: string }> = [];
    const savePosition = vi
      .fn<(key: string, cfi: string, options?: { recordChange?: boolean }) => Promise<void>>()
      .mockImplementation(async (key, cfi) => {
        saved.push({ key, cfi });
      });

    const cfi = "epubcfi(/6/70)";
    await savePositionDualKey({
      panelId: "panel-2",
      bookId: "book-2",
      cfi,
      savePosition,
    });

    expect(saved).toHaveLength(2);
    expect(saved.every((s) => s.cfi === cfi)).toBe(true);
  });
});
