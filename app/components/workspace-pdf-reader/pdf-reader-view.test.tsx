import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "~/lib/settings";

vi.mock("~/components/reader-settings-menu", () => ({
  ReaderSettingsMenu: () => null,
  ReaderFormattingMenu: () => null,
  ReaderActionsMenu: () => null,
}));

import { PdfReaderView } from "~/components/workspace-pdf-reader/pdf-reader-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function touchEvent(
  type: string,
  touches: Array<{ identifier: number; clientX: number; clientY: number }>,
  changedTouches: Array<{ identifier: number; clientX: number; clientY: number }>,
  timeStamp: number,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: touches },
    changedTouches: { value: changedTouches },
    timeStamp: { value: timeStamp },
  });
  return event;
}

function renderView(overrides: Partial<React.ComponentProps<typeof PdfReaderView>> = {}) {
  const goPrev = vi.fn();
  const goNext = vi.fn();
  const goToPage = vi.fn();
  const toggleToolbar = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const containerRef = React.createRef<HTMLDivElement>();
  root = createRoot(host);
  act(() =>
    root?.render(
      <PdfReaderView
        containerRef={containerRef}
        viewerRef={{ current: null }}
        preparePageForCarousel={vi.fn().mockResolvedValue(false)}
        localSettings={{} as Settings}
        onUpdateSettings={vi.fn()}
        book={{ id: "pdf-1", title: "PDF", author: "Author", coverImage: null, format: "pdf" }}
        searchOpen={false}
        searchQuery=""
        searchResultCount={0}
        searchIndex={0}
        searchNext={vi.fn()}
        searchPrev={vi.fn()}
        onSearchOpen={vi.fn()}
        onSearchClose={vi.fn()}
        onSearchQueryChange={vi.fn()}
        isScrollMode={false}
        isMobile={false}
        toggleToolbar={toggleToolbar}
        goPrev={goPrev}
        goNext={goNext}
        toolbarVisible
        totalPages={2}
        currentPage={1}
        bookProgress={50}
        toc={[]}
        tocOpen={false}
        setTocOpen={vi.fn()}
        goToPage={goToPage}
        {...overrides}
      />,
    ),
  );
  return { container: containerRef.current!, goPrev, goNext, goToPage, host, toggleToolbar };
}

it("releases pointer focus while keeping PDF page turns keyboard activatable", () => {
  const goPrev = vi.fn();
  const goNext = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <PdfReaderView
        containerRef={React.createRef<HTMLDivElement>()}
        viewerRef={{ current: null }}
        preparePageForCarousel={vi.fn().mockResolvedValue(false)}
        localSettings={{} as Settings}
        onUpdateSettings={vi.fn()}
        book={{ id: "pdf-1", title: "PDF", author: "Author", coverImage: null, format: "pdf" }}
        onDownload={vi.fn()}
        onBookmarkPage={vi.fn()}
        isBookmarked={false}
        searchOpen={false}
        searchQuery=""
        searchResultCount={0}
        searchIndex={0}
        searchNext={vi.fn()}
        searchPrev={vi.fn()}
        onSearchOpen={vi.fn()}
        onSearchClose={vi.fn()}
        onSearchQueryChange={vi.fn()}
        isScrollMode={false}
        isMobile={false}
        toggleToolbar={vi.fn()}
        goPrev={goPrev}
        goNext={goNext}
        toolbarVisible
        totalPages={2}
        currentPage={1}
        bookProgress={50}
        onOpenNotebook={vi.fn()}
        onOpenChat={vi.fn()}
        toc={[]}
        tocOpen={false}
        setTocOpen={vi.fn()}
        goToPage={vi.fn()}
      />,
    ),
  );

  const turns = [
    {
      overlay: container.querySelector<HTMLButtonElement>("[aria-label='Previous page']")!,
      toolbar: container.querySelector<HTMLButtonElement>("[data-testid='pdf-prev']")!,
      handler: goPrev,
    },
    {
      overlay: container.querySelector<HTMLButtonElement>("[aria-label='Next page']")!,
      toolbar: container.querySelector<HTMLButtonElement>("[data-testid='pdf-next']")!,
      handler: goNext,
    },
  ];

  for (const { overlay, toolbar, handler } of turns) {
    overlay.focus();
    act(() => {
      overlay.dispatchEvent(new Event("pointerup", { bubbles: true }));
      overlay.click();
    });
    expect(document.activeElement).not.toBe(overlay);
    expect(handler).toHaveBeenCalledOnce();

    overlay.focus();
    act(() => overlay.click());
    expect(handler).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(overlay);

    toolbar.focus();
    act(() => {
      toolbar.dispatchEvent(new Event("pointerup", { bubbles: true }));
      toolbar.click();
    });
    expect(document.activeElement).not.toBe(toolbar);
    expect(handler).toHaveBeenCalledTimes(3);

    toolbar.focus();
    act(() => toolbar.click());
    expect(handler).toHaveBeenCalledTimes(4);
    expect(document.activeElement).toBe(toolbar);
  }
});

describe("mobile paginated gestures", () => {
  it("turns one page per swipe without a tap-zone overlay", () => {
    const { container, goToPage, host, toggleToolbar } = renderView({
      isMobile: true,
      currentPage: 2,
      totalPages: 3,
    });
    const start = { identifier: 1, clientX: 180, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchend", [], [{ identifier: 1, clientX: 80, clientY: 55 }], 110),
      );
      container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200 }));
    });
    expect(goToPage).toHaveBeenCalledWith(3);
    expect(toggleToolbar).not.toHaveBeenCalled();

    act(() => {
      container.dispatchEvent(
        touchEvent("touchstart", [{ ...start, clientX: 80 }], [{ ...start, clientX: 80 }], 200),
      );
      container.dispatchEvent(touchEvent("touchend", [], [start], 300));
    });
    expect(goToPage).toHaveBeenCalledWith(1);
    expect(host.querySelector("[aria-label='Previous page']")).toBeNull();
  });

  it("tracks the finger with the current and rendered next page", () => {
    vi.useFakeTimers();
    const pages = [1, 2].map((pageNumber) => {
      const page = document.createElement("div");
      page.className = "page";
      page.dataset.pageNumber = String(pageNumber);
      page.dataset.loaded = "true";
      page.textContent = `Page ${pageNumber}`;
      return { div: page };
    });
    const viewerRef = { current: { getPageView: (index: number) => pages[index] } };
    const preparePageForCarousel = vi.fn().mockResolvedValue(true);
    const { container, goToPage } = renderView({
      isMobile: true,
      viewerRef,
      preparePageForCarousel,
    });
    const viewerElement = document.createElement("div");
    viewerElement.className = "pdfViewer";
    viewerElement.append(pages[0].div);
    container.append(viewerElement);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);

    const start = { identifier: 1, clientX: 220, clientY: 50 };
    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchmove", [{ ...start, clientX: 120 }], [{ ...start, clientX: 120 }], 210),
      );
    });

    const currentFrame = container.querySelector<HTMLElement>("[data-pdf-carousel-page='1']")!;
    const nextFrame = container.querySelector<HTMLElement>("[data-pdf-carousel-page='2']")!;
    expect(currentFrame.style.transform).toContain("-100px");
    expect(nextFrame.style.transform).toContain("300px");
    expect(nextFrame.textContent).toBe("Page 2");
    expect(viewerElement.style.visibility).toBe("hidden");

    act(() => {
      container.dispatchEvent(touchEvent("touchend", [], [{ ...start, clientX: 100 }], 410));
    });
    expect(goToPage).toHaveBeenCalledOnce();
    expect(goToPage).toHaveBeenCalledWith(2);
    expect(currentFrame.style.transform).toContain("-400px");

    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector("[data-pdf-page-carousel]")).toBeNull();
    expect(viewerElement.style.visibility).toBe("");
    vi.useRealTimers();
  });

  it("resists an unavailable previous page and returns to neutral", () => {
    vi.useFakeTimers();
    const page = document.createElement("div");
    page.dataset.pageNumber = "1";
    page.dataset.loaded = "true";
    const viewerRef = { current: { getPageView: () => ({ div: page }) } };
    const { container, goToPage } = renderView({ isMobile: true, viewerRef });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);
    const start = { identifier: 1, clientX: 100, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchmove", [{ ...start, clientX: 220 }], [{ ...start, clientX: 220 }], 210),
      );
    });
    const currentFrame = container.querySelector<HTMLElement>("[data-pdf-carousel-page='1']")!;
    expect(currentFrame.style.transform).toContain("36px");

    act(() => {
      container.dispatchEvent(touchEvent("touchend", [], [{ ...start, clientX: 240 }], 410));
    });
    expect(goToPage).not.toHaveBeenCalled();
    expect(currentFrame.style.transform).toContain("0px");
    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector("[data-pdf-page-carousel]")).toBeNull();
    vi.useRealTimers();
  });

  it("restores the current page when an active drag is cancelled", () => {
    vi.useFakeTimers();
    const page = document.createElement("div");
    page.dataset.pageNumber = "1";
    page.dataset.loaded = "true";
    const viewerRef = { current: { getPageView: () => ({ div: page }) } };
    const { container, goToPage } = renderView({ isMobile: true, viewerRef });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);
    const start = { identifier: 1, clientX: 220, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchmove", [{ ...start, clientX: 120 }], [{ ...start, clientX: 120 }], 210),
      );
      container.dispatchEvent(touchEvent("touchcancel", [], [{ ...start, clientX: 120 }], 220));
    });

    const currentFrame = container.querySelector<HTMLElement>("[data-pdf-carousel-page='1']")!;
    expect(currentFrame.style.transform).toContain("0px");
    expect(goToPage).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(180));
    expect(container.querySelector("[data-pdf-page-carousel]")).toBeNull();
    vi.useRealTimers();
  });

  it("does not reuse page content while the requested neighbor is unavailable", () => {
    const current = document.createElement("div");
    current.dataset.pageNumber = "1";
    current.dataset.loaded = "true";
    current.textContent = "Current page";
    const loading = document.createElement("div");
    loading.dataset.pageNumber = "2";
    loading.textContent = "Stale loading content";
    const pages = [{ div: current }, { div: loading }];
    const viewerRef = { current: { getPageView: (index: number) => pages[index] } };
    const { container } = renderView({ isMobile: true, viewerRef });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);
    const start = { identifier: 1, clientX: 220, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchmove", [{ ...start, clientX: 120 }], [{ ...start, clientX: 120 }], 210),
      );
    });

    const nextFrame = container.querySelector<HTMLElement>("[data-pdf-carousel-page='2']")!;
    expect(nextFrame.childElementCount).toBe(0);
    expect(nextFrame.textContent).not.toContain("Stale loading content");
  });

  it("skips the settle animation when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const page = document.createElement("div");
    page.dataset.pageNumber = "1";
    page.dataset.loaded = "true";
    const viewerRef = { current: { getPageView: () => ({ div: page }) } };
    const { container, goToPage } = renderView({ isMobile: true, viewerRef });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 600,
    } as DOMRect);
    const start = { identifier: 1, clientX: 220, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchmove", [{ ...start, clientX: 80 }], [{ ...start, clientX: 80 }], 210),
      );
      container.dispatchEvent(touchEvent("touchend", [], [{ ...start, clientX: 80 }], 410));
    });

    expect(goToPage).toHaveBeenCalledWith(2);
    expect(container.querySelector("[data-pdf-page-carousel]")).toBeNull();
  });

  it("does not turn a page or toggle the toolbar while text is selected", () => {
    const selection = { isCollapsed: false, toString: () => "selected" } as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(selection);
    const { container, goNext, goPrev, toggleToolbar } = renderView({ isMobile: true });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 400,
    } as DOMRect);
    const start = { identifier: 1, clientX: 180, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchend", [], [{ identifier: 1, clientX: 80, clientY: 50 }], 110),
      );
      container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200 }));
    });

    expect(goPrev).not.toHaveBeenCalled();
    expect(goNext).not.toHaveBeenCalled();
    expect(toggleToolbar).not.toHaveBeenCalled();
  });

  it("leaves continuous-scroll touch behavior unchanged", () => {
    const { container, goNext } = renderView({ isMobile: true, isScrollMode: true });
    const start = { identifier: 1, clientX: 180, clientY: 50 };
    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchend", [], [{ identifier: 1, clientX: 80, clientY: 50 }], 110),
      );
    });
    expect(goNext).not.toHaveBeenCalled();
  });
});
