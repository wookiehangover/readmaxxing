import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useReaderSearch } from "~/hooks/use-reader-search";
import type { BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { useResolvedTheme, useSettings } from "~/lib/settings";
import type { FontWeight, PdfLayout, ReaderLayout } from "~/lib/settings";
import { SpeedreadPopout } from "~/components/speedread-popout";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/hooks/use-highlights";
import type { DockviewPanelApi } from "dockview-react";
import { useIsMobile } from "~/hooks/use-mobile";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useSyncListener } from "~/hooks/use-sync-listener";
import type {
  SuccessorBookAdapter,
  SuccessorRenditionAdapter,
} from "~/lib/epub/successor-reader-adapter";
import { useReaderDwell, type ReadingDwellUnit } from "~/hooks/use-reader-dwell";
import { useBookReaderPreferences } from "~/hooks/use-book-reader-preferences";
import { useBookReaderActions } from "~/hooks/use-book-reader-actions";
import { useEpubPanelSync } from "~/hooks/use-epub-panel-sync";
import { useReadingLocation } from "~/hooks/use-reading-location";
import {
  EpubReaderSurface,
  EpubReaderToolbar,
} from "~/components/workspace-book-reader/epub-reader-chrome";
import { hydrateBookmarksRequested } from "~/lib/themis/bookmarks/bookmarks-slice";

/** Typography overrides restored from dockview panel params */
export interface PanelTypographyParams {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: FontWeight;
  lineHeight?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  readerLayout?: ReaderLayout;
  pdfLayout?: PdfLayout;
}

interface WorkspaceBookReaderProps {
  bookId: string;
  panelApi?: DockviewPanelApi;
  /** Initial typography overrides from restored panel params */
  panelTypography?: PanelTypographyParams;
}

export function WorkspaceBookReader({
  bookId,
  panelApi,
  panelTypography,
}: WorkspaceBookReaderProps) {
  const { navigationMap } = useWorkspace();
  // Ref holding the real navigateToCfi from the inner component once it mounts.
  // Before that, the placeholder callback queues CFIs into pendingCfiRef.
  const realNavRef = useRef<((cfi: string) => void) | null>(null);
  const pendingCfiRef = useRef<string | null>(null);

  // Lifted from the inner component so the outer placeholder can force
  // epub initialization when a navigation request arrives for a background panel.
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

  // Stable placeholder callback registered immediately so the navigation map
  // has an entry even while book metadata is still loading.
  // When the rendition isn't ready yet, queue the CFI and force the epub
  // to start initializing by setting hasBeenVisible = true.
  const placeholderNav = useCallback((cfi: string) => {
    if (realNavRef.current) {
      realNavRef.current(cfi);
    } else {
      pendingCfiRef.current = cfi;
      // Force epub initialization even if the panel hasn't been visible yet
      setHasBeenVisible(true);
    }
  }, []);

  // Register the placeholder immediately — no waiting for book data.
  useEffect(() => {
    const id = panelApi?.id ?? bookId;
    navigationMap.current.set(id, placeholderNav);
    return () => {
      navigationMap.current.delete(id);
    };
  }, [bookId, panelApi, placeholderNav, navigationMap]);

  // Called by WorkspaceBookReaderInner once its rendition is ready
  const onRenditionReady = useCallback((nav: (cfi: string) => void) => {
    realNavRef.current = nav;
    // Drain any CFI that arrived while loading
    const pending = pendingCfiRef.current;
    if (pending) {
      pendingCfiRef.current = null;
      nav(pending);
    }
  }, []);

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
    <WorkspaceBookReaderInner
      book={book}
      panelApi={panelApi}
      panelTypography={panelTypography}
      hasBeenVisible={hasBeenVisible}
      onRenditionReady={onRenditionReady}
    />
  );
}

/**
 * Inner component that renders once we have book data.
 * Manages its own epub lifecycle, TOC state, and keyboard navigation.
 */
function WorkspaceBookReaderInner({
  book,
  panelApi,
  panelTypography,
  hasBeenVisible,
  onRenditionReady,
}: {
  book: BookMeta;
  panelApi?: DockviewPanelApi;
  panelTypography?: PanelTypographyParams;
  /** Whether the panel has been visible at least once (controlled by outer component) */
  hasBeenVisible: boolean;
  /** Called once the rendition is ready so the outer component can connect the real navigate callback */
  onRenditionReady?: (navigateToCfi: (cfi: string) => void) => void;
}) {
  const { tocMap, tocChangeListener, chatContextMap, tempHighlightMap, highlightDeleteMap } =
    useWorkspace();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<SuccessorBookAdapter | null>(null);
  const renditionRef = useRef<SuccessorRenditionAdapter | null>(null);

  const [settings] = useSettings();
  const resolvedTheme = useResolvedTheme(settings.theme);
  const preferenceNavigationRef = useRef<{
    markNavigationInProgress: () => void;
    navigationInProgressRef: React.MutableRefObject<boolean>;
  } | null>(null);
  const {
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    fontWeight: localFontWeight,
    lineHeight: localLineHeight,
    textAlign: localTextAlign,
    readerLayout: localReaderLayout,
    localSettings,
    onUpdateSettings: handleUpdateSettings,
  } = useBookReaderPreferences({
    bookId: book.id,
    panelApi,
    panelTypography,
    settings,
    renditionRef,
    navigationRef: preferenceNavigationRef,
  });

  const [tocOpen, setTocOpen] = useState(false);
  const [speedreadWords, setSpeedreadWords] = useState<string[]>([]);
  const [speedreadOpen, setSpeedreadOpen] = useState(false);
  const [readingDwellUnit, setReadingDwellUnit] = useState<ReadingDwellUnit | null>(null);

  const zenMode = settings.zenMode ?? false;

  const { toolbarVisible, showToolbar, showToolbarPersistent, toggleToolbar, resetToolbarTimer } =
    useToolbarAutoHide(isMobile ?? false, zenMode);

  const {
    searchOpen,
    searchQuery,
    searchResults,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchOpen,
    handleSearchClose,
    handleSearchQueryChange,
    handleSearchOpenFromIframe,
  } = useReaderSearch({
    bookRef,
    renditionRef,
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

  const handleOpenNotebookRef = useRef<() => void>(() => {});

  const {
    selectionPopover,
    saveHighlight: saveHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
    removeHighlightDecoration,
    applyTemporaryHighlight,
  } = useHighlights({
    bookId: book.id,
    renditionRef,
    onHighlightClick: () => handleOpenNotebookRef.current(),
    theme: resolvedTheme,
  });

  const {
    toc,
    currentChapterLabel,
    currentPage,
    totalPages,
    loadError,
    navigateToTocHref,
    flushPositionSave,
    latestCfiRef,
    navigationInProgressRef,
    markNavigationInProgress,
    markLayoutChangeInProgress,
  } = useEpubLifecycle({
    bookId: book.id,
    containerRef,
    readerLayout: localReaderLayout,
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    fontWeight: localFontWeight,
    lineHeight: localLineHeight,
    textAlign: localTextAlign,
    theme: resolvedTheme,
    loadAndApplyHighlights,
    registerSelectionHandler,
    enabled: hasBeenVisible,
    panelId: panelApi?.id,
    chatContextMap,
    onReadingUnitChange: setReadingDwellUnit,
    onRenditionReady,
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
    onSearchOpen: handleSearchOpenFromIframe,
    onRelocated: showToolbar,
    panelRef,
    bookRef,
    renditionRef,
  });
  useReadingLocation(book.id, currentChapterLabel, currentPage, totalPages);
  preferenceNavigationRef.current = { markNavigationInProgress, navigationInProgressRef };

  useReaderDwell({
    bookId: book.id,
    unit: readingDwellUnit,
    displayPage: currentPage,
    panelApi,
  });

  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const store = useAppStore();
  const bookmarks = store.bookmarksSelectors.selectBookmarksByBook.useValue(book.id);
  const bookmarksLoaded = store.bookmarksSelectors.selectBookmarksLoaded.useValue(book.id);

  useEffect(() => {
    store.dispatch(hydrateBookmarksRequested(book.id));
  }, [book.id, bookmarkSyncVersion, store]);

  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    tempHighlightMap.current.set(id, applyTemporaryHighlight);
    return () => {
      tempHighlightMap.current.delete(id);
    };
  }, [book.id, panelApi, applyTemporaryHighlight, tempHighlightMap]);

  const removeHighlightAnnotation = useCallback(
    (cfiRange: string) => {
      removeHighlightDecoration(cfiRange);
    },
    [removeHighlightDecoration],
  );

  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    highlightDeleteMap.current.set(id, removeHighlightAnnotation);
    return () => {
      highlightDeleteMap.current.delete(id);
    };
  }, [book.id, panelApi, removeHighlightAnnotation, highlightDeleteMap]);

  useEpubPanelSync({
    panelApi,
    containerRef,
    renditionRef,
    resolvedTheme,
    flushPositionSave,
    markLayoutChangeInProgress,
  });

  const handlePrev = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    markNavigationInProgress();
    rendition.prev().catch((err: unknown) => {
      navigationInProgressRef.current = false;
      console.error("Failed to navigate to previous page", err);
    });
  }, [markNavigationInProgress, navigationInProgressRef]);
  const handleNext = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    markNavigationInProgress();
    rendition.next().catch((err: unknown) => {
      navigationInProgressRef.current = false;
      console.error("Failed to navigate to next page", err);
    });
  }, [markNavigationInProgress, navigationInProgressRef]);

  const {
    currentBookmark,
    handleSaveHighlight,
    handleAskQuestion,
    handleExplainThis,
    handleCopyAsMarkdown,
    handleDownload,
    handleCopyPageAsMarkdown,
    handleOpenSpeedread,
    handleBookmarkPage,
    handleOpenNotebook,
    handleOpenChat,
  } = useBookReaderActions({
    book,
    bookmarks,
    bookmarksLoaded,
    currentChapterLabel,
    currentPage,
    latestCfiRef,
    renditionRef,
    selectionPopover,
    saveHighlightFromPopover,
    dismissPopovers,
    setSpeedreadWords,
    setSpeedreadOpen,
  });
  handleOpenNotebookRef.current = handleOpenNotebook;

  const isScrollMode = localReaderLayout === "scroll";

  return (
    <div ref={panelRef} className="flex h-full outline-none" tabIndex={0}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <EpubReaderSurface
          containerRef={containerRef}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
          searchResultsLength={searchResults.length}
          searchIndex={searchIndex}
          searchNext={searchNext}
          searchPrev={searchPrev}
          onSearchClose={handleSearchClose}
          onSearchQueryChange={handleSearchQueryChange}
          loadError={loadError}
          readerLayout={localReaderLayout}
          isScrollMode={isScrollMode}
          isMobile={Boolean(isMobile)}
          toggleToolbar={toggleToolbar}
          onPrevious={handlePrev}
          onNext={handleNext}
        />
        <EpubReaderToolbar
          panelApi={panelApi}
          zenMode={zenMode}
          toolbarVisible={toolbarVisible}
          showToolbarPersistent={showToolbarPersistent}
          resetToolbarTimer={resetToolbarTimer}
          currentChapterLabel={currentChapterLabel}
          currentPage={currentPage}
          totalPages={totalPages}
          isScrollMode={isScrollMode}
          isMobile={Boolean(isMobile)}
          onPrevious={handlePrev}
          onNext={handleNext}
          onSearchOpen={handleSearchOpen}
          onOpenNotebook={handleOpenNotebook}
          onOpenChat={handleOpenChat}
          toc={toc}
          tocOpen={tocOpen}
          setTocOpen={setTocOpen}
          navigateToTocHref={navigateToTocHref}
          localSettings={localSettings}
          onUpdateSettings={handleUpdateSettings}
          book={book}
          onDownload={handleDownload}
          onCopyPageAsMarkdown={handleCopyPageAsMarkdown}
          onOpenSpeedread={handleOpenSpeedread}
          onBookmarkPage={handleBookmarkPage}
          isBookmarked={Boolean(currentBookmark)}
          bookmarksLoaded={bookmarksLoaded}
        />
        {/* Portal popovers to document.body to escape dockview's CSS transforms,
            which create a new containing block and break position:fixed */}
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
        {speedreadOpen && (
          <SpeedreadPopout
            bookId={book.id}
            open
            words={speedreadWords}
            onClose={() => setSpeedreadOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
