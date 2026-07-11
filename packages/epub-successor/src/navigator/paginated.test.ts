import { describe, expect, it } from "vitest";

import {
  calculateColumnGeometry,
  calculatePageCount,
  currentSpreadIndex,
  effectivePagesPerSpread,
  lastSpreadPageIndex,
  logicalOffsetFromScrollLeft,
  pageIndexFromOffset,
  pageProgression,
  paginatedProgression,
  scrollLeftFromLogicalOffset,
  snapToSpread,
  spreadPageCount,
  type RtlScrollType,
} from "./paginated";

describe("paginated page math", () => {
  it("floors column geometry so fractional viewports never exceed the live frame", () => {
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
    expect(calculateColumnGeometry(800.6, 32, 1).viewportWidth).toBe(800);
    expect(calculateColumnGeometry(800, 32, 1, 48)).toMatchObject({
      viewportWidth: 800,
      columnWidth: 752,
      columnStride: 784,
    });
  });

  it("snaps a restored element offset to the nearest spread boundary", () => {
    const geometry = calculateColumnGeometry(800.6, 32, 2);
    const scrolling = document.createElement("div");
    scrolling.scrollLeft = geometry.columnStride * 2 + 17;
    const state = {
      ...geometry,
      direction: "ltr" as const,
      pageCount: 8,
      maxOffset: geometry.columnStride * 6,
      rtlScrollType: "reverse" as const,
      scrolling,
    };

    snapToSpread(state);

    expect(scrolling.scrollLeft).toBe(geometry.columnStride * 2);
    expect(scrolling.scrollLeft % geometry.columnStride).toBe(0);
  });

  it("uses the configured minimum width as the double-spread threshold", () => {
    expect(effectivePagesPerSpread(799.9, "double")).toBe(1);
    expect(effectivePagesPerSpread(800, "double")).toBe(2);
    expect(effectivePagesPerSpread(639.9, "double", 640)).toBe(1);
    expect(effectivePagesPerSpread(640, "double", 640)).toBe(2);
    expect(effectivePagesPerSpread(1_200, "single")).toBe(1);
  });

  it("collapses and restores the effective spread as a resize crosses the threshold", () => {
    const widths = [960, 799.5, 801];

    expect(widths.map((width) => effectivePagesPerSpread(width, "double"))).toEqual([2, 1, 2]);
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
