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

  it("keeps the reading surface page-turn click zones active", () => {
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

    act(() => {
      container
        .querySelector("[aria-label='Previous page']")
        ?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      container
        .querySelector("[aria-label='Next page']")
        ?.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
