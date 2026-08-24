import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  eventHandlers: new Map<string, (event?: any) => void>(),
  savedCfi: "page:4" as string | null,
  store: null as any,
}));

vi.mock("~/lib/themis/provider", () => ({
  useAppStore: () => {
    mocks.store ??= {
      dispatch: mocks.dispatch,
      state: {},
      readingPositionsSelectors: {
        selectPosition: { select: () => (mocks.savedCfi ? { cfi: mocks.savedCfi } : undefined) },
      },
    };
    return mocks.store;
  },
}));
vi.mock("~/lib/context/workspace-context", () => ({ useOptionalWorkspace: () => null }));
vi.mock("~/hooks/use-position-nudge", () => ({ usePositionNudge: vi.fn() }));
vi.mock("~/lib/sync/active-readers", () => ({
  registerActiveReader: vi.fn(),
  unregisterActiveReader: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 10, getOutline: async () => null }),
    destroy: async () => undefined,
  }),
}));
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on(name: string, handler: (event?: any) => void) {
      mocks.eventHandlers.set(name, handler);
    }
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFFindController: class {
    setDocument() {}
  },
  PDFViewer: class {
    pagesCount = 10;
    currentScaleValue: string | number = "page-width";
    currentScale = 1;
    scrollMode = 0;
    spreadMode = 0;
    pageColors = null;
    set currentPageNumber(page: number) {
      mocks.eventHandlers.get("pagechanging")?.({ pageNumber: page });
    }
    setDocument() {}
    cleanup() {}
    refresh() {}
    update() {}
    nextPage() {}
    previousPage() {}
  },
}));

import {
  observePdfViewerResize,
  pdfChapterLabelForPage,
  shouldSavePdfPageChange,
  usePdfLifecycle,
} from "~/hooks/use-pdf-lifecycle";
import { recordReadingHistoryRequested } from "~/lib/themis/reading-positions/reading-positions-slice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

beforeEach(() => {
  mocks.dispatch.mockReset().mockImplementation((action) => {
    if (action.type === "readingPositions/hydrateRequested") action.payload[1]?.();
    return action;
  });
  mocks.eventHandlers.clear();
  mocks.savedCfi = "page:4";
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function renderPdfLifecycle(persistPosition: boolean) {
  const host = document.body.appendChild(document.createElement("div"));
  const pdfContainer = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  const loadData = async () => new ArrayBuffer(1);

  function Harness() {
    usePdfLifecycle({
      bookId: "book-1",
      containerRef: { current: pdfContainer },
      loadData,
      initialPosition: "page:4",
      persistPosition,
      pdfLayout: "fit-width",
      theme: "light",
      fontSize: 100,
    });
    return null;
  }

  act(() => root.render(createElement(Harness)));
  await vi.waitFor(() => expect(mocks.eventHandlers.has("pagesinit")).toBe(true));
  await act(async () => {
    mocks.eventHandlers.get("pagesinit")?.();
    await Promise.resolve();
  });
}

describe("PDF reading history", () => {
  it("records real page changes without recording the restored page", async () => {
    await renderPdfLifecycle(true);

    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "readingPositions/recordHistoryRequested" }),
    );

    act(() => mocks.eventHandlers.get("pagechanging")?.({ pageNumber: 5 }));

    expect(mocks.dispatch).toHaveBeenCalledWith(
      recordReadingHistoryRequested("book-1", {
        cfi: "page:5",
        chapterHref: null,
        chapterLabel: null,
        percentage: 50,
        pageIndex: 5,
        totalPages: 10,
      }),
    );
  });

  it("does not record page changes when position persistence is disabled", async () => {
    await renderPdfLifecycle(false);

    act(() => mocks.eventHandlers.get("pagechanging")?.({ pageNumber: 5 }));

    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "readingPositions/recordHistoryRequested" }),
    );
  });
});

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

describe("shouldSavePdfPageChange", () => {
  it("ignores initial and restore-generated page events", () => {
    expect(shouldSavePdfPageChange(false, 1, 12)).toBe(false);
    expect(shouldSavePdfPageChange(true, 12, 12)).toBe(false);
  });

  it("saves a page change after restore", () => {
    expect(shouldSavePdfPageChange(true, 12, 13)).toBe(true);
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
