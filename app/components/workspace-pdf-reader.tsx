import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Notebook,
  Search,
  TableOfContents,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import { useSettings } from "~/lib/settings";
import type { PdfLayout, Settings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { HighlightPopover } from "~/components/highlight-popover";
import { SearchBar } from "~/components/search-bar";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";
import type { DockviewPanelApi } from "dockview";
import { useIsMobile } from "~/hooks/use-mobile";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import { usePdfSearch } from "~/hooks/use-pdf-search";
import { usePdfHighlights } from "~/hooks/use-pdf-highlights";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import { useWorkspace } from "~/lib/workspace-context";
import { usePdfWorkspacePanels } from "~/hooks/use-pdf-workspace-panels";
import type { PanelTypographyParams } from "~/components/workspace-book-reader";

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

  const {
    data: book,
    error,
    isLoading,
  } = useEffectQuery(
    () =>
      BookService.pipe(
        Effect.andThen((s) => s.getBook(bookId)),
        Effect.catchTag("BookNotFoundError", () => Effect.succeed(null as BookMeta | null)),
      ),
    [bookId],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading book…</p>
      </div>
    );
  }

  if (error || !book) {
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
    bookProgress,
    currentPage,
    totalPages,
    goToPage,
    goNext,
    goPrev,
    flushPositionSave,
    pdfDocRef,
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

  const { handleSaveHighlight, handleOpenNotebook, handleOpenChat, setGoToPage } =
    usePdfWorkspacePanels({
      book,
      panelApi,
      currentPage,
      pdfDocRef,
      saveHighlightFromPopover,
      applyTempHighlight,
      removeHighlight,
      handleOpenNotebookRef,
    });

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

  return (
    <div ref={panelRef} className="flex h-full flex-col outline-none" tabIndex={0}>
      <div className="relative flex-1 overflow-hidden">
        {searchOpen && (
          <div className="absolute top-0 right-0 left-0 z-10">
            <SearchBar
              query={searchQuery}
              onQueryChange={handleSearchQueryChange}
              resultCount={searchResultCount}
              currentIndex={searchIndex}
              onNext={searchNext}
              onPrev={searchPrev}
              onClose={handleSearchClose}
            />
          </div>
        )}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto"
          data-testid="pdf-container"
        />
        {!isScrollMode && (
          <div className="pointer-events-none absolute inset-0 z-[5]">
            <button
              type="button"
              aria-label="Previous page"
              className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
              onPointerUp={goPrev}
            />
            {isMobile && (
              <button
                type="button"
                aria-label="Toggle toolbar"
                className="pointer-events-auto absolute top-0 left-1/4 h-full w-1/2 appearance-none border-none bg-transparent p-0"
                onPointerUp={toggleToolbar}
              />
            )}
            <button
              type="button"
              aria-label="Next page"
              className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
              onPointerUp={goNext}
            />
          </div>
        )}
      </div>
      <div
        className={cn(
          "relative flex items-center justify-center border-t px-2 h-10 mb-[env(safe-area-inset-bottom)] transition-all duration-300 ease-in-out",
          {
            "max-h-0 overflow-hidden border-t-0 opacity-0": isMobile && !toolbarVisible,
            "max-h-20 opacity-100": !isMobile || toolbarVisible,
          },
        )}
      >
        <div className="absolute left-2 flex items-center gap-1.5">
          {totalPages > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              Page {currentPage} of {totalPages}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {Math.round(bookProgress)}%
            </span>
          )}
        </div>
        {!isScrollMode && (
          <div className="hidden items-center gap-4 md:flex">
            <Button variant="ghost" size="icon" onClick={goPrev} data-testid="pdf-prev">
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={goNext} data-testid="pdf-next">
              <ChevronRight className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        )}
        <div className="absolute right-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (searchOpen ? handleSearchClose() : handleSearchOpen())}
            title="Search in book (Cmd+F)"
            data-testid="pdf-search-btn"
          >
            <Search className="size-4" />
            <span className="sr-only">Search in book</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleOpenNotebook} title="Open Notebook">
            <Notebook className="size-4" />
            <span className="sr-only">Open Notebook</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={handleOpenChat} title="Open Chat">
            <MessageCircle className="size-4" />
            <span className="sr-only">Open Chat</span>
          </Button>
          {toc.length > 0 && (
            <Popover open={tocOpen} onOpenChange={setTocOpen}>
              <PopoverTrigger
                render={<Button variant="ghost" size="icon" title="Table of Contents" />}
              >
                <TableOfContents className="size-4" />
                <span className="sr-only">Table of Contents</span>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={8}
                className="max-h-80 w-64 overflow-y-auto p-1.5"
              >
                <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Table of Contents
                </p>
                <ul>
                  <TocList
                    entries={toc}
                    onNavigate={(href) => {
                      try {
                        const dest = JSON.parse(href);
                        if (typeof dest === "number") {
                          goToPage(dest + 1);
                        }
                      } catch {
                        // ignore
                      }
                      setTocOpen(false);
                    }}
                  />
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <ReaderSettingsMenu
            settings={localSettings}
            onUpdateSettings={handleUpdateSettings}
            isPdf
          />
        </div>
      </div>
      {/* Portal popovers to document.body to escape dockview's CSS transforms */}
      {selectionPopover &&
        createPortal(
          <HighlightPopover
            position={selectionPopover.position}
            selectedText={selectionPopover.text}
            onSave={handleSaveHighlight}
            onDismiss={dismissPopovers}
          />,
          document.body,
        )}
    </div>
  );
}
