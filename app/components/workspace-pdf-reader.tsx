import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useSettings } from "~/lib/settings";
import type { PdfLayout, Settings } from "~/lib/settings";
import { HighlightPopover } from "~/components/highlight-popover";
import { useAppStore } from "~/lib/themis/provider";
import { useIsMobile } from "~/hooks/use-mobile";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import { useReadingLocation } from "~/hooks/use-reading-location";
import { usePdfSearch } from "~/hooks/use-pdf-search";
import { usePdfHighlights } from "~/hooks/use-pdf-highlights";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import { useWorkspace } from "~/lib/context/workspace-context";
import { usePdfWorkspacePanels } from "~/hooks/use-pdf-workspace-panels";
import type { PanelTypographyParams } from "~/components/workspace-book-reader";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { PdfReaderView } from "~/components/workspace-pdf-reader/pdf-reader-view";
import {
  addBookmarkRequested,
  deleteBookmarkRequested,
  hydrateBookmarksRequested,
} from "~/lib/themis/bookmarks/bookmarks-slice";
import { useSyncToFurthestPosition } from "~/hooks/use-sync-to-furthest-position";

interface WorkspacePdfReaderProps {
  bookId: string;
  panelTypography?: PanelTypographyParams;
}

export function WorkspacePdfReader({ bookId, panelTypography }: WorkspacePdfReaderProps) {
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

  return <WorkspacePdfReaderInner book={book} panelTypography={panelTypography} />;
}

function WorkspacePdfReaderInner({
  book,
  panelTypography,
}: {
  book: BookMeta;
  panelTypography?: PanelTypographyParams;
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
    pdfDocRef,
    eventBusRef,
  } = usePdfLifecycle({
    bookId: book.id,
    containerRef,
    pdfLayout: localPdfLayout,
    theme: settings.theme,
    fontSize: localFontSize,
    onTocExtracted: (tocData) => {
      tocMap.current.set(book.id, tocData);
      tocChangeListener.current?.();
    },
    onCleanupToc: () => {
      tocMap.current.delete(book.id);
      tocChangeListener.current?.();
    },
    onRelocated: showToolbar,
    panelRef,
    onAfterRender: reapplyAllHighlights,
  });
  useReadingLocation(book.id, currentChapterLabel, currentPage, totalPages);

  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const store = useAppStore();
  const bookmarks = store.bookmarksSelectors.selectBookmarksByBook.useValue(book.id);
  const bookmarksLoaded = store.bookmarksSelectors.selectBookmarksLoaded.useValue(book.id);

  useEffect(() => {
    store.dispatch(hydrateBookmarksRequested(book.id));
  }, [book.id, bookmarkSyncVersion, store]);

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

  const handleUpdateSettings = useCallback((update: Partial<Settings>) => {
    if (update.fontSize !== undefined) setLocalFontSize(update.fontSize);
    if (update.pdfLayout !== undefined) setLocalPdfLayout(update.pdfLayout);
  }, []);

  const {
    handleSaveHighlight,
    handleAskQuestion,
    handleExplainThis,
    handleOpenNotebook,
    handleOpenChat,
    setGoToPage,
  } = usePdfWorkspacePanels({
    book,
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
    BookService.getBookData(book.id)
      .catch((error: unknown) => {
        console.error("Failed to download book:", error);
        return null;
      })
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

  const currentBookmark = bookmarks.find((bookmark) => bookmark.pageNumber === currentPage);

  const handleBookmarkPage = useCallback(() => {
    if (!bookmarksLoaded) return;
    if (currentPage < 1) return;
    const existingBookmark = bookmarks.find((bookmark) => bookmark.pageNumber === currentPage);
    const now = Date.now();

    store.dispatch(
      existingBookmark
        ? deleteBookmarkRequested(book.id, existingBookmark.id)
        : addBookmarkRequested({
            id: `bookmark:${book.id}:page:${currentPage}`,
            bookId: book.id,
            pageNumber: currentPage,
            label: `Page ${currentPage}`,
            createdAt: now,
            updatedAt: now,
          }),
    );
  }, [book.id, bookmarks, bookmarksLoaded, currentPage, store]);

  // Keep goToPage in sync for navigation map
  useEffect(() => {
    setGoToPage(goToPage);
  }, [goToPage, setGoToPage]);

  const isScrollMode = localPdfLayout === "continuous";

  const getCurrentPosition = useCallback(() => `page:${currentPage}`, [currentPage]);
  const navigateToPosition = useCallback(
    (position: string) => {
      const page = Number(position.slice("page:".length));
      if (position.startsWith("page:") && Number.isSafeInteger(page) && page > 0) goToPage(page);
    },
    [goToPage],
  );
  const handleSyncToFurthestPage = useSyncToFurthestPosition({
    bookId: book.id,
    getCurrentPosition,
    navigateToPosition,
  });

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
        containerRef={containerRef}
        localSettings={localSettings}
        onUpdateSettings={handleUpdateSettings}
        book={book}
        onSyncToFurthestPage={handleSyncToFurthestPage}
        onDownload={handleDownload}
        onBookmarkPage={handleBookmarkPage}
        isBookmarked={Boolean(currentBookmark)}
        bookmarksLoaded={bookmarksLoaded}
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
      {/* Portal popovers to document.body so position:fixed is viewport-relative. */}
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
