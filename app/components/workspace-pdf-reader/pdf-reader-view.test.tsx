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
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
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
  const toggleToolbar = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const containerRef = React.createRef<HTMLDivElement>();
  root = createRoot(host);
  act(() =>
    root?.render(
      <PdfReaderView
        containerRef={containerRef}
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
        goToPage={vi.fn()}
        {...overrides}
      />,
    ),
  );
  return { container: containerRef.current!, goPrev, goNext, host, toggleToolbar };
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
    const { container, goNext, goPrev, host, toggleToolbar } = renderView({ isMobile: true });
    const start = { identifier: 1, clientX: 180, clientY: 50 };

    act(() => {
      container.dispatchEvent(touchEvent("touchstart", [start], [start], 10));
      container.dispatchEvent(
        touchEvent("touchend", [], [{ identifier: 1, clientX: 80, clientY: 55 }], 110),
      );
      container.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200 }));
    });
    expect(goNext).toHaveBeenCalledOnce();
    expect(toggleToolbar).not.toHaveBeenCalled();

    act(() => {
      container.dispatchEvent(
        touchEvent("touchstart", [{ ...start, clientX: 80 }], [{ ...start, clientX: 80 }], 200),
      );
      container.dispatchEvent(touchEvent("touchend", [], [start], 300));
    });
    expect(goPrev).toHaveBeenCalledOnce();
    expect(host.querySelector("[aria-label='Previous page']")).toBeNull();
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
