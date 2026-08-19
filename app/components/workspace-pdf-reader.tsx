import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useSettings } from "~/lib/settings";
import type { PdfLayout, Settings } from "~/lib/settings";
import { HighlightPopover } from "~/components/highlight-popover";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { AppRuntime } from "~/lib/effect-runtime";
import { useAppStore } from "~/lib/themis/provider";
import type { DockviewPanelApi } from "dockview-react";
import { useIsMobile } from "~/hooks/use-mobile";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import { useReadingLocation } from "~/hooks/use-reading-location";
import { usePdfSearch } from "~/hooks/use-pdf-search";
import { usePdfHighlights } from "~/hooks/use-pdf-highlights";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import { useWorkspace } from "~/lib/context/workspace-context";
import { usePdfWorkspacePanels } from "~/hooks/use-pdf-workspace-panels";
import type { PanelTypographyParams } from "~/components/workspace-book-reader";
import { BookmarkService, type Bookmark as BookmarkRecord } from "~/lib/stores/bookmark-store";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { PdfReaderView } from "~/components/workspace-pdf-reader/pdf-reader-view";

interface WorkspacePdfReaderProps {
  bookId: string;
  panelApi?: DockviewPanelApi;
  panelTypography?: PanelTypographyParams;
}

export function WorkspacePdfReader({ bookId, panelApi, panelTypography }: WorkspacePdfReaderProps) {
  const [hasBeenVisible, setHasBeenVisible] = useState(() =>
    panelApi ? panelApi.isVisible : true,
  );

  useEffect(() => {
    if (!panelApi || hasBeenVisible) return;
    if (panelApi.isVisible) {
      setHasBeenVisible(true);
      return;
    }
    const disposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) {
        setHasBeenVisible(true);
        disposable.dispose();
      }
    });
    return () => disposable.dispose();
  }, [panelApi, hasBeenVisible]);

  // Look up book metadata from the Themis books collection. Populated at app
  // startup by the books hydrate saga, so this is a synchronous read.
  const store = useAppStore();
  const booksLoading = store.booksSelectors.selectBooksLoading.useValue();
  const book = store.booksSelectors.selectBookById.useValue(bookId);

  if (!book && booksLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading book…</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Book not found.</p>
      </div>
    );
  }

  return (
    <WorkspacePdfReaderInner
      book={book}
      panelApi={panelApi}
      panelTypography={panelTypography}
      hasBeenVisible={hasBeenVisible}
    />
  );
}

function WorkspacePdfReaderInner({
  book,
  panelApi,
  panelTypography,
  hasBeenVisible,
}: {
  book: BookMeta;
  panelApi?: DockviewPanelApi;
  panelTypography?: PanelTypographyParams;
  hasBeenVisible: boolean;
}) {
  const { tocMap, tocChangeListener } = useWorkspace();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [settings] = useSettings();

  const [localFontSize, setLocalFontSize] = useState<number>(
    () => panelTypography?.fontSize ?? settings.fontSize,
  );
  const [localPdfLayout, setLocalPdfLayout] = useState<PdfLayout>(
    () => (panelTypography?.pdfLayout as PdfLayout) ?? settings.pdfLayout,
  );

  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
  const { toolbarVisible, showToolbar, toggleToolbar } = useToolbarAutoHide(isMobile ?? false);

  // Ref-based callback so usePdfHighlights always calls the latest handleOpenNotebook
  const handleOpenNotebookRef = useRef<() => void>(() => {});

  const {
    selectionPopover,
    saveHighlight: saveHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    reapplyAllHighlights,
    removeHighlight,
    applyTempHighlight,
  } = usePdfHighlights({
    bookId: book.id,
    containerRef,
    theme: settings.theme,
    onHighlightClick: () => handleOpenNotebookRef.current(),
  });

  const {
    toc,
    currentChapterLabel,
    bookProgress,
    currentPage,
    hasRestoredPosition,
    totalPages,
    goToPage,
    goNext,
    goPrev,
    flushPositionSave,
    pdfDocRef,
    viewerRef,
    eventBusRef,
  } = usePdfLifecycle({
    bookId: book.id,
    containerRef,
    pdfLayout: localPdfLayout,
    theme: settings.theme,
    fontSize: localFontSize,
    enabled: hasBeenVisible,
    panelId: panelApi?.id,
    onTocExtracted: (tocData) => {
      const id = panelApi?.id ?? book.id;
      tocMap.current.set(id, tocData);
      tocChangeListener.current?.();
    },
    onCleanupToc: () => {
      const id = panelApi?.id ?? book.id;
      tocMap.current.delete(id);
      tocChangeListener.current?.();
    },
    onRelocated: showToolbar,
    panelRef,
    onAfterRender: reapplyAllHighlights,
  });
  useReadingLocation(book.id, currentChapterLabel, currentPage, totalPages);

  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const { data: bookmarks } = useEffectQuery(
    () =>
      BookmarkService.pipe(
        Effect.andThen((s) => s.getBookmarksByBook(book.id)),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to load bookmarks:", error);
            return [] as BookmarkRecord[];
          }),
        ),
      ),
    [book.id, bookmarkVersion, bookmarkSyncVersion],
  );

  // Load highlights once after initial render
  const highlightsLoadedRef = useRef(false);
  useEffect(() => {
    if (totalPages > 0 && !highlightsLoadedRef.current) {
      highlightsLoadedRef.current = true;
      loadAndApplyHighlights();
    }
  }, [totalPages, loadAndApplyHighlights]);

  const {
    searchOpen,
    searchQuery,
    searchResultCount,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchOpen,
    handleSearchClose,
    handleSearchQueryChange,
  } = usePdfSearch({
    eventBusRef,
    bookId: book.id,
    panelRef,
  });

  useEffect(() => {
    const handleBookSearchOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (detail?.bookId !== book.id) return;
      handleSearchOpen();
    };

    window.addEventListener("book-search:open", handleBookSearchOpen);
    return () => window.removeEventListener("book-search:open", handleBookSearchOpen);
  }, [book.id, handleSearchOpen]);

  // Handle panel visibility changes
  useEffect(() => {
    if (!panelApi) return;

    const visDisposable = panelApi.onDidVisibilityChange((e) => {
      if (!e.isVisible) flushPositionSave();
    });

    return () => {
      visDisposable.dispose();
    };
  }, [panelApi, flushPositionSave]);

  // Handle panel dimension changes — recalculate PDF layout when the panel resizes
  useEffect(() => {
    if (!panelApi) return;

    let rafId: number | null = null;
    const dimensionsDisposable = panelApi.onDidDimensionsChange(() => {
      // The PDF viewer needs to recalculate scale/layout when container dimensions change
      // Use requestAnimationFrame to coalesce rapid resize events during drag-resize
      if (rafId !== null) cancelAnimationFrame(rafId);

      rafId = requestAnimationFrame(() => {
        rafId = null;
        const viewer = viewerRef.current;
        if (viewer && typeof viewer.update === "function") {
          const scaleValue = viewer.currentScaleValue;
          if (typeof scaleValue === "string" && Number.isNaN(Number(scaleValue))) {
            viewer.currentScaleValue = scaleValue;
          } else {
            viewer.update();
          }
        }
      });
    });

    return () => {
      dimensionsDisposable.dispose();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [panelApi, viewerRef]);

  const handleUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      if (update.fontSize !== undefined) setLocalFontSize(update.fontSize);
      if (update.pdfLayout !== undefined) setLocalPdfLayout(update.pdfLayout);

      if (panelApi) {
        const paramUpdates: Record<string, unknown> = {};
        if (update.fontSize !== undefined) paramUpdates.fontSize = update.fontSize;
        if (update.pdfLayout !== undefined) paramUpdates.pdfLayout = update.pdfLayout;
        if (Object.keys(paramUpdates).length > 0) {
          panelApi.updateParameters(paramUpdates);
        }
      }
    },
    [panelApi],
  );

  const {
    handleSaveHighlight,
    handleAskQuestion,
    handleExplainThis,
    handleOpenNotebook,
    handleOpenChat,
    setGoToPage,
  } = usePdfWorkspacePanels({
    book,
    panelApi,
    currentPage,
    hasRestoredPosition,
    selectionText: selectionPopover?.text,
    pdfDocRef,
    saveHighlightFromPopover,
    applyTempHighlight,
    removeHighlight,
    dismissPopovers,
    handleOpenNotebookRef,
  });

  const handleCopyAsMarkdown = useCallback(async () => {
    if (!selectionPopover) return;

    await navigator.clipboard.writeText(selectionPopover.text);
    dismissPopovers();
    window.getSelection()?.removeAllRanges();
  }, [selectionPopover, dismissPopovers]);

  const handleDownload = useCallback(() => {
    AppRuntime.runPromise(
      BookService.pipe(
        Effect.andThen((s) => s.getBookData(book.id)),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to download book:", error);
            return null as ArrayBuffer | null;
          }),
        ),
      ),
    )
      .then((data) => {
        if (!data) return;
        const format = book.format ?? "pdf";
        const type = format === "pdf" ? "application/pdf" : "application/epub+zip";
        const blob = new Blob([data], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${book.title.replace(/[\\/:*?"<>|]/g, "-")}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      })
      .catch(console.error);
  }, [book.id, book.title, book.format]);

  const currentBookmark = bookmarks?.find((bookmark) => bookmark.pageNumber === currentPage);

  const handleBookmarkPage = useCallback(async () => {
    if (currentPage < 1) return;
    const existingBookmark = bookmarks?.find((bookmark) => bookmark.pageNumber === currentPage);
    const now = Date.now();

    await AppRuntime.runPromise(
      BookmarkService.pipe(
        Effect.andThen((s) =>
          existingBookmark
            ? s.deleteBookmark(existingBookmark.id)
            : s.saveBookmark({
                id: `bookmark:${book.id}:page:${currentPage}`,
                bookId: book.id,
                pageNumber: currentPage,
                label: `Page ${currentPage}`,
                createdAt: now,
                updatedAt: now,
              }),
        ),
      ),
    );
    setBookmarkVersion((version) => version + 1);
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("sync:entity-updated", { detail: { entity: "bookmark" } }),
      );
    });
  }, [book.id, bookmarks, currentPage]);

  // Keep goToPage in sync for navigation map
  useEffect(() => {
    setGoToPage(goToPage);
  }, [goToPage, setGoToPage]);

  const isScrollMode = localPdfLayout === "continuous";

  const localSettings: Settings = {
    ...settings,
    fontSize: localFontSize,
    pdfLayout: localPdfLayout,
  };

  const handlePanelPointerDown = useCallback(() => {
    const panel = panelRef.current;

    if (!panel?.contains(document.activeElement)) {
      panel?.focus({ preventScroll: true });
    }
  }, []);

  return (
    <div
      ref={panelRef}
      className="flex h-full flex-col outline-none"
      tabIndex={0}
      onPointerDown={handlePanelPointerDown}
    >
      <PdfReaderView
        panelApi={panelApi}
        containerRef={containerRef}
        localSettings={localSettings}
        onUpdateSettings={handleUpdateSettings}
        book={book}
        onDownload={handleDownload}
        onBookmarkPage={handleBookmarkPage}
        isBookmarked={Boolean(currentBookmark)}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        searchResultCount={searchResultCount}
        searchIndex={searchIndex}
        searchNext={searchNext}
        searchPrev={searchPrev}
        onSearchOpen={handleSearchOpen}
        onSearchClose={handleSearchClose}
        onSearchQueryChange={handleSearchQueryChange}
        isScrollMode={isScrollMode}
        isMobile={Boolean(isMobile)}
        toggleToolbar={toggleToolbar}
        goPrev={goPrev}
        goNext={goNext}
        toolbarVisible={toolbarVisible}
        totalPages={totalPages}
        currentPage={currentPage}
        bookProgress={bookProgress}
        onOpenNotebook={handleOpenNotebook}
        onOpenChat={handleOpenChat}
        toc={toc}
        tocOpen={tocOpen}
        setTocOpen={setTocOpen}
        goToPage={goToPage}
      />
      {/* Portal popovers to document.body to escape dockview's CSS transforms */}
      {selectionPopover &&
        createPortal(
          <HighlightPopover
            position={selectionPopover.position}
            onCopyAsMarkdown={handleCopyAsMarkdown}
            onAskQuestion={handleAskQuestion}
            onExplain={handleExplainThis}
            onSave={handleSaveHighlight}
            onDismiss={dismissPopovers}
          />,
          document.body,
        )}
    </div>
  );
}
