import { afterEach, describe, expect, it, vi } from "vitest";
import { observePdfViewerResize, pdfChapterLabelForPage } from "~/hooks/use-pdf-lifecycle";

afterEach(() => vi.unstubAllGlobals());

describe("pdfChapterLabelForPage", () => {
  const chapters = [
    { label: "Introduction", page: 1 },
    { label: "Part I", page: 12 },
    { label: "Chapter 3", page: 48 },
  ];

  it("uses the nearest PDF bookmark at or before the current page", () => {
    expect(pdfChapterLabelForPage(chapters, 1)).toBe("Introduction");
    expect(pdfChapterLabelForPage(chapters, 47)).toBe("Part I");
    expect(pdfChapterLabelForPage(chapters, 48)).toBe("Chapter 3");
    expect(pdfChapterLabelForPage(chapters, 200)).toBe("Chapter 3");
  });

  it("returns null before the first resolved bookmark", () => {
    expect(pdfChapterLabelForPage([{ label: "Chapter 1", page: 5 }], 2)).toBeNull();
  });
});

describe("observePdfViewerResize", () => {
  it("coalesces container resizes and recalculates the PDF viewer layout", () => {
    let resizeCallback!: ResizeObserverCallback;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = observe;
      unobserve = vi.fn();
      disconnect = disconnect;
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);

    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      frames.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const container = document.createElement("div");
    const update = vi.fn();
    let scaleValue: string | number = "page-width";
    const setScale = vi.fn((value: string | number) => {
      scaleValue = value;
    });
    const viewer = {
      get currentScaleValue() {
        return scaleValue;
      },
      set currentScaleValue(value: string | number) {
        setScale(value);
      },
      update,
    };

    const cleanup = observePdfViewerResize(container, () => viewer);
    expect(observe).toHaveBeenCalledWith(container);

    resizeCallback([], {} as ResizeObserver);
    frames.get(1)?.(0);
    expect(setScale).toHaveBeenCalledWith("page-width");
    expect(update).not.toHaveBeenCalled();

    scaleValue = 1.25;
    resizeCallback([], {} as ResizeObserver);
    resizeCallback([], {} as ResizeObserver);
    expect(cancelFrame).toHaveBeenCalledWith(2);
    frames.get(3)?.(0);
    expect(update).toHaveBeenCalledOnce();

    resizeCallback([], {} as ResizeObserver);
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(4);
  });
});
