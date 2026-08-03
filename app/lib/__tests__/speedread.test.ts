import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEEDREAD_WPM,
  MAX_SPEEDREAD_WPM,
  MIN_SPEEDREAD_WPM,
  SPEEDREAD_WPM_STORAGE_KEY,
  clampSpeedreadWpm,
  clampSpeedreadWordIndex,
  parseStoredSpeedreadWpm,
  fingerprintSpeedreadWords,
  resolveSpeedreadWordIndex,
  speedreadIntervalMs,
  speedreadProgressStorageKey,
  tokenizeSpeedreadText,
} from "~/lib/speedread";

describe("tokenizeSpeedreadText", () => {
  it("splits text on whitespace while preserving punctuation", () => {
    expect(tokenizeSpeedreadText("Hello, world! Don't stop.")).toEqual([
      "Hello,",
      "world!",
      "Don't",
      "stop.",
    ]);
  });

  it("collapses mixed and repeated whitespace", () => {
    expect(tokenizeSpeedreadText("  one\n\t two   three  ")).toEqual(["one", "two", "three"]);
  });

  it("returns no words for empty or whitespace-only text", () => {
    expect(tokenizeSpeedreadText("")).toEqual([]);
    expect(tokenizeSpeedreadText(" \n\t ")).toEqual([]);
  });
});

describe("speedreadIntervalMs", () => {
  it("converts words per minute to milliseconds per word", () => {
    expect(speedreadIntervalMs(300)).toBe(200);
    expect(speedreadIntervalMs(120)).toBe(500);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid WPM %s", (wpm) => {
    expect(() => speedreadIntervalMs(wpm)).toThrow(RangeError);
  });
});

describe("Speedread WPM", () => {
  it("clamps finite values to the slider range", () => {
    expect(clampSpeedreadWpm(50)).toBe(MIN_SPEEDREAD_WPM);
    expect(clampSpeedreadWpm(450)).toBe(450);
    expect(clampSpeedreadWpm(1_000)).toBe(MAX_SPEEDREAD_WPM);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, "300", null])(
    "falls back for invalid WPM %s",
    (wpm) => {
      expect(clampSpeedreadWpm(wpm)).toBe(DEFAULT_SPEEDREAD_WPM);
    },
  );

  it("parses stored values and falls back for missing or invalid storage", () => {
    expect(parseStoredSpeedreadWpm("425")).toBe(425);
    expect(parseStoredSpeedreadWpm("50")).toBe(MIN_SPEEDREAD_WPM);
    expect(parseStoredSpeedreadWpm("1000")).toBe(MAX_SPEEDREAD_WPM);
    expect(parseStoredSpeedreadWpm(null)).toBe(DEFAULT_SPEEDREAD_WPM);
    expect(parseStoredSpeedreadWpm("invalid")).toBe(DEFAULT_SPEEDREAD_WPM);
  });

  it("uses a global key separate from progress and layout", () => {
    expect(SPEEDREAD_WPM_STORAGE_KEY).toBe("speedread-wpm");
    expect(SPEEDREAD_WPM_STORAGE_KEY).not.toBe(speedreadProgressStorageKey("book-1"));
    expect(SPEEDREAD_WPM_STORAGE_KEY).not.toBe("speedread-popout-position");
  });
});

describe("Speedread progress", () => {
  it("fingerprints the full word list and includes its length", () => {
    expect(fingerprintSpeedreadWords(["same", "page"])).toBe(
      fingerprintSpeedreadWords(["same", "page"]),
    );
    expect(fingerprintSpeedreadWords(["same", "page"])).not.toBe(
      fingerprintSpeedreadWords(["next", "page"]),
    );
    expect(fingerprintSpeedreadWords(["same", "page"])).not.toBe(
      fingerprintSpeedreadWords(["same"]),
    );
  });

  it("restores only matching progress and clamps it to the page", () => {
    const fingerprint = fingerprintSpeedreadWords(["one", "two", "three"]);
    expect(resolveSpeedreadWordIndex({ wordIndex: 1, fingerprint }, fingerprint, 3)).toBe(1);
    expect(resolveSpeedreadWordIndex({ wordIndex: 20, fingerprint }, fingerprint, 3)).toBe(2);
    expect(resolveSpeedreadWordIndex({ wordIndex: 1, fingerprint: "other" }, fingerprint, 3)).toBe(
      0,
    );
    expect(resolveSpeedreadWordIndex("invalid", fingerprint, 3)).toBe(0);
  });

  it("clamps invalid, negative, fractional, and empty-page indexes", () => {
    expect(clampSpeedreadWordIndex(Number.NaN, 3)).toBe(0);
    expect(clampSpeedreadWordIndex(-2, 3)).toBe(0);
    expect(clampSpeedreadWordIndex(1.9, 3)).toBe(1);
    expect(clampSpeedreadWordIndex(2, 0)).toBe(0);
  });

  it("uses a separate per-book progress key", () => {
    expect(speedreadProgressStorageKey("book-1")).toBe("speedread-progress:book-1");
    expect(speedreadProgressStorageKey("book-1")).not.toBe("speedread-popout-position");
  });
});
