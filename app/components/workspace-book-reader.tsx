import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Notebook,
  Search,
  TableOfContents,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { SearchBar } from "~/components/search-bar";
import { useReaderSearch } from "~/hooks/use-reader-search";
import { TocList } from "~/components/book-list";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { PdfLayout, ReaderLayout, Settings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/hooks/use-highlights";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { cn } from "~/lib/utils";
import { registerThemeColors, injectThemeColors } from "~/lib/epub/epub-theme-utils";
import type { DockviewPanelApi } from "dockview";
import { useIsMobile } from "~/hooks/use-mobile";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import { useWorkspace } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { appendHighlightReferenceToNotebook } from "~/lib/annotations/append-highlight-to-notebook";

/** Typography overrides restored from dockview panel params */
export interface PanelTypographyParams {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
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

  // Load book data via useEffectQuery
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
  const ws = useWorkspace();
  const {
    tocMap,
    tocChangeListener,
    notebookCallbackMap,
    chatContextMap,
    tempHighlightMap,
    highlightDeleteMap,
  } = ws;
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<import("epubjs/types/book").default | null>(null);
  const renditionRef = useRef<import("epubjs/types/rendition").default | null>(null);

  const [settings] = useSettings();

  // Per-panel typography overrides: initialized from panel params (restored layout)
  // or global settings as fallback. These are local to this panel instance.
  const [localFontFamily, setLocalFontFamily] = useState<string>(
    () => panelTypography?.fontFamily ?? settings.fontFamily,
  );
  const [localFontSize, setLocalFontSize] = useState<number>(
    () => panelTypography?.fontSize ?? settings.fontSize,
  );
  const [localLineHeight, setLocalLineHeight] = useState<number>(
    () => panelTypography?.lineHeight ?? settings.lineHeight,
  );
  const [localReaderLayout, setLocalReaderLayout] = useState<ReaderLayout>(
    () => panelTypography?.readerLayout ?? settings.readerLayout,
  );

  const [tocOpen, setTocOpen] = useState(false);

  // Mobile toolbar auto-hide
  const { toolbarVisible, showToolbar, toggleToolbar } = useToolbarAutoHide(isMobile ?? false);

  // Search state (shared hook)
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

  // Ref-based callback so useHighlights always calls the latest handleOpenNotebook
  const handleOpenNotebookRef = useRef<() => void>(() => {});

  const {
    selectionPopover,
    saveHighlight: saveHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
    highlightsRef,
  } = useHighlights({
    bookId: book.id,
    renditionRef,
    onHighlightClick: () => handleOpenNotebookRef.current(),
    theme: settings.theme,
  });

  const {
    toc,
    currentChapterLabel,
    currentPage,
    totalPages,
    navigateToTocHref,
    flushPositionSave,
    latestCfiRef,
  } = useEpubLifecycle({
    bookId: book.id,
    containerRef,
    readerLayout: localReaderLayout,
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
    theme: settings.theme,
    loadAndApplyHighlights,
    registerSelectionHandler,
    enabled: hasBeenVisible,
    panelId: panelApi?.id,
    chatContextMap,
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

  // Temporary highlight: briefly flash a CFI range in the reader
  const applyTempHighlight = useCallback((cfi: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    try {
      rendition.annotations.highlight(
        cfi,
        {},
        undefined as any,
        undefined as any,
        { fill: "rgba(255, 213, 79, 0.4)", "fill-opacity": "0.4" } as any,
      );
      setTimeout(() => {
        try {
          rendition.annotations.remove(cfi, "highlight");
        } catch {
          // annotation may already be gone
        }
      }, 3000);
    } catch {
      // annotation may already be gone
    }
  }, []);

  // Register temp highlight callback
  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    tempHighlightMap.current.set(id, applyTempHighlight);
    return () => {
      tempHighlightMap.current.delete(id);
    };
  }, [book.id, panelApi, applyTempHighlight, tempHighlightMap]);

  // Register highlight delete callback so notebooks can remove annotations from rendition
  const removeHighlightAnnotation = useCallback(
    (cfiRange: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      rendition.annotations.remove(cfiRange, "highlight");
      highlightsRef.current.delete(cfiRange);
    },
    [highlightsRef],
  );

  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    highlightDeleteMap.current.set(id, removeHighlightAnnotation);
    return () => {
      highlightDeleteMap.current.delete(id);
    };
  }, [book.id, panelApi, removeHighlightAnnotation, highlightDeleteMap]);

  // With renderer: "always", dockview keeps the DOM alive when the tab is hidden
  // (instead of removing it). The epub iframe stays intact, so we only need to
  // reapply theme (in case it changed while hidden) and resize (in case the
  // container dimensions changed).
  useEffect(() => {
    if (!panelApi) return;

    const handleBecameVisible = () => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // Re-resolve and re-register theme colors before selecting
      registerThemeColors(rendition);

      // Directly inject updated theme CSS into iframe documents
      const effectiveTheme = resolveTheme(settings.theme);
      injectThemeColors(rendition, effectiveTheme);

      rendition.themes.select(effectiveTheme);

      // Save the current reading position before resize — epubjs resize()
      // recalculates pagination and can jump to a different page.
      const cfiBeforeResize = latestCfiRef.current;

      // Resize in case container dimensions changed, then restore position
      requestAnimationFrame(() => {
        if (!renditionRef.current) return;
        try {
          (renditionRef.current as any).resize();
        } catch {
          // rendition manager may not be initialized yet
          return;
        }
        if (cfiBeforeResize) {
          renditionRef.current.display(cfiBeforeResize).catch(() => {});
        }
      });
    };

    const visDisposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) {
        handleBecameVisible();
      } else {
        flushPositionSave();
      }
    });

    const activeDisposable = panelApi.onDidActiveChange((e) => {
      if (e.isActive) handleBecameVisible();
    });

    // Resize the epub rendition when the panel dimensions change (e.g. a new
    // pane is opened or the divider is dragged). We use requestAnimationFrame
    // to coalesce rapid resize events during drag-resize.
    let resizeRafId: number | null = null;
    const dimensionsDisposable = panelApi.onDidDimensionsChange(() => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);

      const cfiBeforeResize = latestCfiRef.current;
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (!renditionRef.current) return;
        try {
          (renditionRef.current as any).resize();
        } catch {
          // rendition manager may not be initialized yet
          return;
        }
        if (cfiBeforeResize) {
          renditionRef.current.display(cfiBeforeResize).catch(() => {});
        }
      });
    });

    return () => {
      visDisposable.dispose();
      activeDisposable.dispose();
      dimensionsDisposable.dispose();
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
    };
  }, [panelApi, settings.theme, flushPositionSave]);

  const handlePrev = useCallback(() => renditionRef.current?.prev(), []);
  const handleNext = useCallback(() => renditionRef.current?.next(), []);

  const handleUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      // Update local state only — do NOT propagate to global settings.
      // Theme changes are ignored here (theme stays global).
      if (update.fontFamily !== undefined) setLocalFontFamily(update.fontFamily);
      if (update.fontSize !== undefined) setLocalFontSize(update.fontSize);
      if (update.lineHeight !== undefined) setLocalLineHeight(update.lineHeight);
      if (update.readerLayout !== undefined && update.readerLayout !== localReaderLayout) {
        const cfi = renditionRef.current?.location?.start?.cfi;
        setLocalReaderLayout(update.readerLayout);
        if (cfi) queueMicrotask(() => renditionRef.current?.display(cfi));
      }

      // Persist overrides in dockview panel params so they survive layout save/restore
      if (panelApi) {
        const paramUpdates: Record<string, unknown> = {};
        if (update.fontFamily !== undefined) paramUpdates.fontFamily = update.fontFamily;
        if (update.fontSize !== undefined) paramUpdates.fontSize = update.fontSize;
        if (update.lineHeight !== undefined) paramUpdates.lineHeight = update.lineHeight;
        if (update.readerLayout !== undefined) paramUpdates.readerLayout = update.readerLayout;
        if (Object.keys(paramUpdates).length > 0) {
          panelApi.updateParameters(paramUpdates);
        }
      }
    },
    [localReaderLayout, panelApi],
  );

  const handleSaveHighlight = useCallback(async () => {
    const highlight = await saveHighlightFromPopover();
    if (!highlight) return;
    const attrs = {
      highlightId: highlight.id,
      cfiRange: highlight.cfiRange,
      text: highlight.text,
    };
    const appendFn = notebookCallbackMap.current.get(book.id);
    if (appendFn) {
      appendFn(attrs);
      return;
    }
    // Notebook panel isn't mounted — write the reference directly to IDB so
    // the highlight is visible (and deletable) the next time the notebook
    // opens, instead of silently orphaning it.
    AppRuntime.runPromise(appendHighlightReferenceToNotebook(book.id, attrs))
      .then(() => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
          );
        });
      })
      .catch((err) => console.error("Failed to append highlight to notebook:", err));
  }, [saveHighlightFromPopover, notebookCallbackMap, book.id]);

  // Delegate to the workspace-level openers so focused-mode cluster rules
  // (add-tab in right group, no splitting) are applied uniformly.
  const handleOpenNotebook = useCallback(() => {
    ws.openNotebookRef.current?.(book);
  }, [ws, book]);

  // Keep ref in sync so useHighlights click handler always calls latest version
  handleOpenNotebookRef.current = handleOpenNotebook;

  const handleOpenChat = useCallback(() => {
    ws.openChatRef.current?.(book);
  }, [ws, book]);

  const isScrollMode = localReaderLayout === "scroll";

  // Construct a settings-like object with local typography values for the menu
  const localSettings: Settings = {
    ...settings,
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
    readerLayout: localReaderLayout,
  };

  return (
    <div ref={panelRef} className="flex h-full outline-none" tabIndex={0}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1 overflow-hidden">
          {searchOpen && (
            <div className="absolute top-0 right-0 left-0 z-10">
              <SearchBar
                query={searchQuery}
                onQueryChange={handleSearchQueryChange}
                resultCount={searchResults.length}
                currentIndex={searchIndex}
                onNext={searchNext}
                onPrev={searchPrev}
                onClose={handleSearchClose}
              />
            </div>
          )}
          <div
            ref={containerRef}
            className={cn("h-full overflow-hidden", {
              "px-4 pt-6 pb-2 md:px-8 md:pt-10 md:pb-4": localReaderLayout,
            })}
          />
          {!isScrollMode && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              {/* Previous page zone: narrow margin on desktop, 25% on mobile */}
              <button
                type="button"
                aria-label="Previous page"
                className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={handlePrev}
              />
              {/* Center zone: toolbar toggle on mobile only */}
              {isMobile && (
                <button
                  type="button"
                  aria-label="Toggle toolbar"
                  className="pointer-events-auto absolute top-0 left-1/4 h-full w-1/2 appearance-none border-none bg-transparent p-0"
                  onPointerUp={toggleToolbar}
                />
              )}
              {/* Next page zone: narrow margin on desktop, 25% on mobile */}
              <button
                type="button"
                aria-label="Next page"
                className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={handleNext}
              />
            </div>
          )}
        </div>
        <div
          className={cn(
            "relative flex items-center justify-center px-2 h-10 transition-all duration-300 ease-in-out",
            {
              "max-h-0 overflow-hidden border-t-0 opacity-0": isMobile && !toolbarVisible,
              "max-h-20 opacity-100": !isMobile || toolbarVisible,
            },
          )}
        >
          <div className="absolute left-2 flex max-w-[calc(100%-8rem)] items-center gap-1.5">
            {totalPages !== null && currentPage !== null ? (
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                {currentChapterLabel ? (
                  <>
                    <span className="max-w-28 truncate sm:max-w-48 md:max-w-64">
                      {currentChapterLabel}
                    </span>
                    <span className="shrink-0">·</span>
                  </>
                ) : null}
                <span className="shrink-0 tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
              </div>
            ) : null}
          </div>
          {!isScrollMode && (
            <div className="hidden items-center gap-4 md:flex">
              <Button variant="ghost" size="icon" onClick={handlePrev}>
                <ChevronLeft className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={handleNext}>
                <ChevronRight className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          )}
          <div className="absolute right-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSearchOpen}
              title="Search in book (Cmd+F)"
            >
              <Search className="size-4" />
              <span className="sr-only">Search in book</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={handleOpenNotebook} title="Open Notebook">
              <Notebook className="size-4" />
              <span className="sr-only">Open Notebook</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={handleOpenChat} title="Chat about book">
              <MessageSquare className="size-4" />
              <span className="sr-only">Chat about book</span>
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
                        navigateToTocHref(href);
                        setTocOpen(false);
                      }}
                    />
                  </ul>
                </PopoverContent>
              </Popover>
            )}
            <ReaderSettingsMenu settings={localSettings} onUpdateSettings={handleUpdateSettings} />
          </div>
        </div>
        {/* Portal popovers to document.body to escape dockview's CSS transforms,
            which create a new containing block and break position:fixed */}
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
    </div>
  );
}
