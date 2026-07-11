import { afterEach, describe, expect, it, vi } from "vitest";

import {
  alignPaginationToElement,
  animateScrollToPage,
  calculateColumnGeometry,
  calculatePageCount,
  currentSpreadIndex,
  effectivePagesPerSpread,
  lastSpreadPageIndex,
  logicalOffsetFromScrollLeft,
  pageChromeInsets,
  pageIndexFromOffset,
  pageProgression,
  paginatedProgression,
  scrollLeftFromLogicalOffset,
  snapToSpread,
  spreadPageCount,
  type RtlScrollType,
} from "./paginated";

function mockAnimationFrames(view: Window) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.spyOn(view, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi
    .spyOn(view, "cancelAnimationFrame")
    .mockImplementation((id) => void callbacks.delete(id));
  return {
    cancel,
    runNext(timestamp: number) {
      const entry = callbacks.entries().next();
      if (entry.done) throw new Error("No animation frame is pending");
      const [id, callback] = entry.value;
      callbacks.delete(id);
      callback(timestamp);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

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

  it("packs columns to the full viewport with no inline body padding", () => {
    // Horizontal padding is 0 so page 1 and later pages share the same origin.
    const even = pageChromeInsets(800, 64, 2);
    expect(even.padInlineStart).toBe(0);
    expect(even.padInlineEnd).toBe(0);
    expect(even.geometry).toMatchObject({
      viewportWidth: 800,
      columnWidth: 368,
      columnGap: 64,
      columnStride: 432,
      pagesPerSpread: 2,
    });
    expect(even.geometry.columnWidth * 2 + even.geometry.columnGap).toBe(800);
    expect(even.padBlock).toBe(24);

    const odd = pageChromeInsets(801.4, 64, 2);
    expect(odd.padInlineStart).toBe(0);
    expect(odd.padInlineEnd).toBe(0);
    expect(odd.geometry.columnWidth * 2 + odd.geometry.columnGap).toBeLessThanOrEqual(801);
  });

  it("uses full width for single-page columns", () => {
    const single = pageChromeInsets(800, 64, 1);
    expect(single.padInlineStart).toBe(0);
    expect(single.padInlineEnd).toBe(0);
    expect(single.geometry.columnWidth).toBe(800);
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

  it("aligns pagination to the floor column containing an element", () => {
    const geometry = calculateColumnGeometry(800, 32, 1);
    const scrolling = document.createElement("div");
    // At section start (scroll 0), element lives in column 3.
    scrolling.scrollLeft = 0;
    Object.defineProperty(scrolling, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    });
    const state = {
      ...geometry,
      direction: "ltr" as const,
      pageCount: 8,
      maxOffset: geometry.columnStride * 7,
      rtlScrollType: "reverse" as const,
      scrolling,
    };
    const element = document.createElement("span");
    element.getBoundingClientRect = () =>
      ({
        left: geometry.columnStride * 3 + 40,
        top: 20,
        right: geometry.columnStride * 3 + 44,
        bottom: 40,
        width: 4,
        height: 20,
        x: geometry.columnStride * 3 + 40,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    alignPaginationToElement(state, element);

    expect(scrolling.scrollLeft).toBe(geometry.columnStride * 3);
  });

  it("does not advance a page when the caret is past mid-column", () => {
    const geometry = calculateColumnGeometry(800, 32, 1);
    const scrolling = document.createElement("div");
    scrolling.scrollLeft = 0;
    Object.defineProperty(scrolling, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    });
    const state = {
      ...geometry,
      direction: "ltr" as const,
      pageCount: 8,
      maxOffset: geometry.columnStride * 7,
      rtlScrollType: "reverse" as const,
      scrolling,
    };
    const element = document.createElement("span");
    // 90% into column 2 — round() would jump to column 3; floor stays on 2.
    element.getBoundingClientRect = () =>
      ({
        left: geometry.columnStride * 2 + geometry.columnStride * 0.9,
        top: 20,
        right: geometry.columnStride * 2 + geometry.columnStride * 0.9 + 4,
        bottom: 40,
        width: 4,
        height: 20,
        x: geometry.columnStride * 2 + geometry.columnStride * 0.9,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    alignPaginationToElement(state, element);

    expect(scrolling.scrollLeft).toBe(geometry.columnStride * 2);
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

  it("tweens to an RTL-correct page offset with cubic ease-out", async () => {
    const scrolling = document.createElement("div");
    scrolling.scrollLeft = 600;
    const state = {
      ...calculateColumnGeometry(200, 0, 1),
      direction: "rtl" as const,
      pageCount: 4,
      maxOffset: 600,
      rtlScrollType: "default" as const,
      scrolling,
    };
    const frames = mockAnimationFrames(window);

    const animation = animateScrollToPage(state, 1, 100);
    frames.runNext(10);
    frames.runNext(60);

    expect(scrolling.scrollLeft).toBeCloseTo(425);
    frames.runNext(110);
    await animation.finished;
    expect(scrolling.scrollLeft).toBe(400);
  });

  it("cancels a tween in place without snapping by default", async () => {
    const scrolling = document.createElement("div");
    const state = {
      ...calculateColumnGeometry(200, 0, 1),
      direction: "ltr" as const,
      pageCount: 4,
      maxOffset: 600,
      rtlScrollType: "reverse" as const,
      scrolling,
    };
    const frames = mockAnimationFrames(window);
    const animation = animateScrollToPage(state, 2, 100);
    frames.runNext(0);
    frames.runNext(50);
    const partialOffset = scrolling.scrollLeft;

    animation.cancel();
    await animation.finished;

    expect(partialOffset).toBeCloseTo(350);
    expect(scrolling.scrollLeft).toBe(partialOffset);
    expect(frames.cancel).toHaveBeenCalledOnce();
  });

  it("snaps to the logical target when cancellation requests it", async () => {
    const scrolling = document.createElement("div");
    const state = {
      ...calculateColumnGeometry(200, 0, 1),
      direction: "rtl" as const,
      pageCount: 4,
      maxOffset: 600,
      rtlScrollType: "negative" as const,
      scrolling,
    };
    const frames = mockAnimationFrames(window);
    const animation = animateScrollToPage(state, 2, 100);

    animation.cancel(true);
    await animation.finished;

    expect(scrolling.scrollLeft).toBe(-400);
    expect(frames.cancel).toHaveBeenCalledOnce();
  });
});
