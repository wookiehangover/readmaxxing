import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderLayout, Settings } from "~/lib/settings";

vi.mock("~/components/reading-shell/reading-rail-menu-portal", () => ({
  ReadingRailMenuPortal: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rail-menu">{children}</div>
  ),
}));
vi.mock("~/components/reader-settings-menu", () => ({
  ReaderSettingsMenu: () => <button type="button">Reader settings</button>,
  ReaderFormattingMenu: () => null,
  ReaderActionsMenu: () => null,
}));

import {
  EpubReaderSurface,
  EpubReaderToolbar,
} from "~/components/workspace-book-reader/epub-reader-chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let resizeReaderPane: (width: number) => void;
let inlinePadding = 128;

beforeEach(() => {
  inlinePadding = 128;
  class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeReaderPane = (width) =>
        callback(
          [{ contentRect: { width } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
    }

    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(
      () =>
        ({
          paddingInlineStart: `${inlinePadding / 2}px`,
          paddingInlineEnd: `${inlinePadding / 2}px`,
        }) as CSSStyleDeclaration,
    ),
  );
});

function renderReaderSurface(readerLayout: ReaderLayout) {
  const container = document.body.appendChild(document.createElement("div"));
  const containerRef = React.createRef<HTMLDivElement>();
  root = createRoot(container);
  act(() =>
    root?.render(
      <EpubReaderSurface
        containerRef={containerRef}
        searchOpen={false}
        searchQuery=""
        searchResultsLength={0}
        searchIndex={0}
        searchNext={vi.fn()}
        searchPrev={vi.fn()}
        onSearchClose={vi.fn()}
        onSearchQueryChange={vi.fn()}
        loadError={false}
        readerLayout={readerLayout}
        isScrollMode={readerLayout === "scroll"}
        isMobile={false}
        toggleToolbar={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    ),
  );
  return containerRef.current!;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function setReaderPaneWidth(width: number) {
  act(() => resizeReaderPane(width));
}

describe("EpubReaderToolbar", () => {
  it("centers and constrains the single-page surface", () => {
    const surface = renderReaderSurface("single");

    for (const width of [927, 928]) {
      setReaderPaneWidth(width);
      expect(surface.classList).toContain("mx-auto");
      expect(surface.classList).toContain("max-w-[72ch]");
      expect(surface.classList).not.toContain("max-w-[calc(144ch+64px)]");
    }
  });

  it("matches the requested spread cap to the effective column count", () => {
    const surface = renderReaderSurface("spread");

    expect(surface.classList).toContain("mx-auto");
    setReaderPaneWidth(927);
    expect(surface.classList).toContain("max-w-[72ch]");
    expect(surface.classList).not.toContain("max-w-[calc(144ch+64px)]");

    setReaderPaneWidth(928);
    expect(surface.classList).toContain("max-w-[calc(144ch+64px)]");
    expect(surface.classList).not.toContain("max-w-[72ch]");

    setReaderPaneWidth(927);
    expect(surface.classList).toContain("max-w-[72ch]");
    expect(surface.classList).not.toContain("max-w-[calc(144ch+64px)]");
  });

  it("accounts for the current responsive inline padding", () => {
    const surface = renderReaderSurface("spread");
    inlinePadding = 80;

    setReaderPaneWidth(879);
    expect(surface.classList).toContain("max-w-[72ch]");
    expect(surface.classList).not.toContain("max-w-[calc(144ch+64px)]");

    setReaderPaneWidth(880);
    expect(surface.classList).toContain("max-w-[calc(144ch+64px)]");
    expect(surface.classList).not.toContain("max-w-[72ch]");
  });

  it("leaves the scroll surface at full available width", () => {
    const surface = renderReaderSurface("scroll");

    for (const width of [927, 928]) {
      setReaderPaneWidth(width);
      expect(surface.classList).not.toContain("mx-auto");
      expect(surface.classList).not.toContain("max-w-[72ch]");
      expect(surface.classList).not.toContain("max-w-[calc(144ch+64px)]");
    }
  });

  it("renders only the rail menu when mounted in the reading shell", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <EpubReaderToolbar
          toc={[]}
          navigateToTocHref={vi.fn()}
          localSettings={{} as Settings}
          onUpdateSettings={vi.fn()}
          book={{
            id: "book-1",
            title: "Book",
            author: "Author",
            coverImage: null,
            format: "epub",
          }}
          onDownload={vi.fn()}
          onCopyPageAsMarkdown={vi.fn()}
          onOpenSpeedread={vi.fn()}
          onBookmarkPage={vi.fn()}
          isBookmarked={false}
        />,
      ),
    );

    expect(container.querySelector("[data-testid='rail-menu']")).not.toBeNull();
    expect(container.textContent).toBe("Reader settings");
    expect(container.querySelector("[aria-label='Previous page']")).toBeNull();
    expect(container.querySelector("[aria-label='Next page']")).toBeNull();
    expect(container.textContent).not.toContain("Chapter 1");
    expect(container.textContent).not.toContain("1 / 10");
  });

  it("turns once per pointer gesture and keeps overlay keyboard activation focused", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <EpubReaderSurface
          containerRef={React.createRef<HTMLDivElement>()}
          searchOpen={false}
          searchQuery=""
          searchResultsLength={0}
          searchIndex={0}
          searchNext={vi.fn()}
          searchPrev={vi.fn()}
          onSearchClose={vi.fn()}
          onSearchQueryChange={vi.fn()}
          loadError={false}
          readerLayout="spread"
          isScrollMode={false}
          isMobile={false}
          toggleToolbar={vi.fn()}
          onPrevious={onPrevious}
          onNext={onNext}
        />,
      ),
    );

    const previous = container.querySelector<HTMLButtonElement>("[aria-label='Previous page']")!;
    const next = container.querySelector<HTMLButtonElement>("[aria-label='Next page']")!;

    for (const [button, handler] of [
      [previous, onPrevious],
      [next, onNext],
    ] as const) {
      button.focus();
      expect(document.activeElement).toBe(button);
      act(() => {
        button.dispatchEvent(new Event("pointerup", { bubbles: true }));
        button.click();
      });
      expect(handler).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(button);

      button.focus();
      act(() => button.click());
      expect(handler).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(button);
    }
  });
});
