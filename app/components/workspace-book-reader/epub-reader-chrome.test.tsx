import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "~/lib/settings";

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

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("EpubReaderToolbar", () => {
  it("renders only the rail menu when mounted in the reading shell", () => {
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <EpubReaderToolbar
          zenMode={false}
          toolbarVisible
          showToolbarPersistent={vi.fn()}
          resetToolbarTimer={vi.fn()}
          currentChapterLabel="Chapter 1"
          currentPage={1}
          totalPages={10}
          isScrollMode={false}
          isMobile={false}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onSearchOpen={vi.fn()}
          onOpenNotebook={vi.fn()}
          onOpenChat={vi.fn()}
          toc={[]}
          tocOpen={false}
          setTocOpen={vi.fn()}
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

  it("turns pages and releases pointer focus from the reading surface click zones", () => {
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

    for (const button of [previous, next]) {
      button.focus();
      expect(document.activeElement).toBe(button);
      act(() => button.dispatchEvent(new Event("pointerup", { bubbles: true })));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(document.activeElement).not.toBe(button);
    }

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("keeps toolbar page-turn controls keyboard activatable", () => {
    const onNext = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() =>
      root?.render(
        <EpubReaderToolbar
          panelApi={{} as never}
          zenMode={false}
          toolbarVisible
          showToolbarPersistent={vi.fn()}
          resetToolbarTimer={vi.fn()}
          currentChapterLabel={null}
          currentPage={1}
          totalPages={10}
          isScrollMode={false}
          isMobile={false}
          onPrevious={vi.fn()}
          onNext={onNext}
          onSearchOpen={vi.fn()}
          onOpenNotebook={vi.fn()}
          onOpenChat={vi.fn()}
          toc={[]}
          tocOpen={false}
          setTocOpen={vi.fn()}
          navigateToTocHref={vi.fn()}
          localSettings={{} as Settings}
          onUpdateSettings={vi.fn()}
          book={{ id: "book-1", title: "Book", author: "Author", coverImage: null, format: "epub" }}
          onDownload={vi.fn()}
          onCopyPageAsMarkdown={vi.fn()}
          onOpenSpeedread={vi.fn()}
          onBookmarkPage={vi.fn()}
          isBookmarked={false}
        />,
      ),
    );

    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      button.textContent?.includes("Next page"),
    )!;
    next.focus();
    act(() => next.click());

    expect(onNext).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(next);
  });
});
