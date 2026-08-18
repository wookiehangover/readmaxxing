import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
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
});

it("releases pointer focus while keeping PDF page turns keyboard activatable", () => {
  const goPrev = vi.fn();
  const goNext = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      <PdfReaderView
        panelApi={{} as never}
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
