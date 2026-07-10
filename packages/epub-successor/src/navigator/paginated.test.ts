import { describe, expect, it } from "vitest";

import {
  calculateColumnGeometry,
  calculatePageCount,
  currentSpreadIndex,
  lastSpreadPageIndex,
  logicalOffsetFromScrollLeft,
  pageIndexFromOffset,
  pageProgression,
  paginatedProgression,
  scrollLeftFromLogicalOffset,
  spreadPageCount,
  type RtlScrollType,
} from "./paginated";

describe("paginated page math", () => {
  it("snaps column geometry to integer pixels for single pages and spreads", () => {
    expect(calculateColumnGeometry(801.4, 31.6, 1)).toEqual({
      viewportWidth: 801,
      columnWidth: 801,
      columnGap: 32,
      columnStride: 833,
      pagesPerSpread: 1,
    });
    expect(calculateColumnGeometry(801.4, 31.6, 2)).toEqual({
      viewportWidth: 801,
      columnWidth: 384,
      columnGap: 32,
      columnStride: 416,
      pagesPerSpread: 2,
    });
  });

  it("calculates pages, spread counts, and page-based progression", () => {
    const geometry = calculateColumnGeometry(800, 32, 2);
    expect(calculatePageCount(2048, geometry)).toBe(5);
    expect(spreadPageCount(5, 2)).toBe(3);
    expect(lastSpreadPageIndex(5, 2)).toBe(4);
    expect(pageIndexFromOffset(geometry.columnStride * 2, geometry)).toBe(2);
    expect(pageProgression(2, 5)).toBe(0.5);
  });

  it("maps a clamped final two-page spread to its final progression", () => {
    const geometry = calculateColumnGeometry(800, 32, 2);
    const scrolling = document.createElement("div");
    scrolling.scrollLeft = geometry.columnStride * 3;
    const state = {
      ...geometry,
      direction: "ltr" as const,
      pageCount: 5,
      maxOffset: geometry.columnStride * 3,
      rtlScrollType: "reverse" as const,
      scrolling,
    };
    expect(currentSpreadIndex(state)).toBe(2);
    expect(paginatedProgression(state)).toBe(1);
  });

  it.each<RtlScrollType>(["default", "negative", "reverse"])(
    "round-trips logical offsets for %s rtl coordinates",
    (type) => {
      const physical = scrollLeftFromLogicalOffset(240, 600, "rtl", type);
      expect(logicalOffsetFromScrollLeft(physical, 600, "rtl", type)).toBe(240);
    },
  );

  it("maps all rtl coordinate behaviors from the reading-order start", () => {
    expect(logicalOffsetFromScrollLeft(600, 600, "rtl", "default")).toBe(0);
    expect(logicalOffsetFromScrollLeft(-600, 600, "rtl", "negative")).toBe(600);
    expect(logicalOffsetFromScrollLeft(600, 600, "rtl", "reverse")).toBe(600);
  });
});
