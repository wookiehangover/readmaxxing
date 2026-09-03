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
import { useIsMobile } from "~/hooks/use-mobile";
import { useHasTouchCapability } from "~/hooks/use-touch-capability";
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
import { useReadingLocation } from "~/hooks/use-reading-location";
import {
  EpubReaderSurface,
  EpubReaderToolbar,
} from "~/components/workspace-book-reader/epub-reader-chrome";
import { hydrateBookmarksRequested } from "~/lib/themis/bookmarks/bookmarks-slice";
import { useSyncToFurthestPosition } from "~/hooks/use-sync-to-furthest-position";

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
  /** Initial typography overrides from restored panel params */
  panelTypography?: PanelTypographyParams;
}

export function WorkspaceBookReader({ bookId, panelTypography }: WorkspaceBookReaderProps) {
  const { navigationMap } = useWorkspace();
  // Ref holding the real navigateToCfi from the inner component once it mounts.
  // Before that, the placeholder callback queues CFIs into pendingCfiRef.
  const realNavRef = useRef<((cfi: string) => void) | null>(null);
  const pendingCfiRef = useRef<string | null>(null);

  // Stable placeholder callback registered immediately so the navigation map
  // has an entry even while book metadata is still loading.
  // When the rendition isn't ready yet, queue the CFI until initialization completes.
  const placeholderNav = useCallback((cfi: string) => {
    if (realNavRef.current) {
      realNavRef.current(cfi);
    } else {
      pendingCfiRef.current = cfi;
    }
  }, []);

  // Register the placeholder immediately — no waiting for book data.
  useEffect(() => {
    realNavRef.current = null;
    navigationMap.current.set(bookId, placeholderNav);
    return () => {
      realNavRef.current = null;
      if (navigationMap.current.get(bookId) === placeholderNav)
        navigationMap.current.delete(bookId);
    };
  }, [bookId, placeholderNav, navigationMap]);

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
      key={book.id}
      book={book}
      panelTypography={panelTypography}
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
  panelTypography,
  onRenditionReady,
}: {
  book: BookMeta;
  panelTypography?: PanelTypographyParams;
  /** Called once the rendition is ready so the outer component can connect the real navigate callback */
  onRenditionReady?: (navigateToCfi: (cfi: string) => void) => void;
}) {
  const { tocMap, tocChangeListener, chatContextMap, tempHighlightMap, highlightDeleteMap } =
    useWorkspace();
  const isMobile = useIsMobile();
  const hasTouchCapability = useHasTouchCapability();
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
    panelTypography,
    settings,
    renditionRef,
    navigationRef: preferenceNavigationRef,
  });

  const [speedreadWords, setSpeedreadWords] = useState<string[]>([]);
  const [speedreadOpen, setSpeedreadOpen] = useState(false);
  const [readingDwellUnit, setReadingDwellUnit] = useState<ReadingDwellUnit | null>(null);

  const zenMode = settings.zenMode ?? false;

  const { showToolbar, toggleToolbar } = useToolbarAutoHide(isMobile ?? false, zenMode);

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
    navigateToCfi,
    navigateToTocHref,
    latestCfiRef,
    navigationInProgressRef,
    markNavigationInProgress,
  } = useEpubLifecycle({
    bookId: book.id,
    reviewContext: true,
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
    chatContextMap,
    onReadingUnitChange: setReadingDwellUnit,
    onRenditionReady,
    onTocExtracted: (tocData) => {
      tocMap.current.set(book.id, tocData);
      tocChangeListener.current?.();
    },
    onCleanupToc: () => {
      tocMap.current.delete(book.id);
      tocChangeListener.current?.();
    },
    onSearchOpen: handleSearchOpenFromIframe,
    onRelocated: showToolbar,
    isMobile: Boolean(isMobile),
    enablePageSwiping: isMobile || hasTouchCapability,
    onToggleToolbar: toggleToolbar,
    panelRef,
    bookRef,
    renditionRef,
  });
  useReadingLocation(book.id, currentChapterLabel, currentPage, totalPages);
  preferenceNavigationRef.current = { markNavigationInProgress, navigationInProgressRef };

  const getCurrentPosition = useCallback(() => latestCfiRef.current, [latestCfiRef]);
  const handleSyncToFurthestPage = useSyncToFurthestPosition({
    bookId: book.id,
    getCurrentPosition,
    navigateToPosition: navigateToCfi,
  });

  useReaderDwell({
    bookId: book.id,
    unit: readingDwellUnit,
    displayPage: currentPage,
  });

  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const store = useAppStore();
  const bookmarks = store.bookmarksSelectors.selectBookmarksByBook.useValue(book.id);
  const bookmarksLoaded = store.bookmarksSelectors.selectBookmarksLoaded.useValue(book.id);
  const reviewsEnabled = store.reviewsSelectors.selectReviewPreferences(book.id);
  const reviewLocked = store.reviewsSelectors.selectReviewLocked(book.id);
  useEffect(() => {
    // A pre-existing popout may contain a full-spine snapshot. Opening it again
    // reads the navigator's newly bounded chapter after the preference change.
    setSpeedreadOpen(false);
  }, [reviewsEnabled.value.enabled]);

  useEffect(() => {
    store.dispatch(hydrateBookmarksRequested(book.id));
  }, [book.id, bookmarkSyncVersion, store]);

  useEffect(() => {
    tempHighlightMap.current.set(book.id, applyTemporaryHighlight);
    return () => {
      tempHighlightMap.current.delete(book.id);
    };
  }, [book.id, applyTemporaryHighlight, tempHighlightMap]);

  const removeHighlightAnnotation = useCallback(
    (cfiRange: string) => {
      removeHighlightDecoration(cfiRange);
    },
    [removeHighlightDecoration],
  );

  useEffect(() => {
    highlightDeleteMap.current.set(book.id, removeHighlightAnnotation);
    return () => {
      highlightDeleteMap.current.delete(book.id);
    };
  }, [book.id, removeHighlightAnnotation, highlightDeleteMap]);

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
          onPrevious={handlePrev}
          onNext={handleNext}
        />
        <EpubReaderToolbar
          toc={toc}
          navigateToTocHref={navigateToTocHref}
          localSettings={localSettings}
          onUpdateSettings={handleUpdateSettings}
          book={book}
          onSyncToFurthestPage={handleSyncToFurthestPage}
          onDownload={handleDownload}
          onCopyPageAsMarkdown={handleCopyPageAsMarkdown}
          onOpenSpeedread={handleOpenSpeedread}
          onBookmarkPage={handleBookmarkPage}
          isBookmarked={Boolean(currentBookmark)}
          bookmarksLoaded={bookmarksLoaded}
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
        {speedreadOpen && !reviewLocked.value && (
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
