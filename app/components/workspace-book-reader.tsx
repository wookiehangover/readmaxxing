import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
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
import { useBookSearch } from "~/lib/use-book-search";
import { TocList } from "~/components/book-list";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { LocationCacheService } from "~/lib/location-cache-store";
import { ReadingPositionService } from "~/lib/position-store";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout, Settings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/lib/use-highlights";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";
import { registerThemeColors, getThemeColorCss, injectThemeColors } from "~/lib/epub-theme-utils";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";
import type { DockviewPanelApi } from "dockview";
import type { TocEntry } from "~/lib/reader-context";
import { getTypographyCss, getRenditionOptions } from "~/lib/epub-rendering-utils";
import { useIsMobile } from "~/hooks/use-mobile";

/** Auto-hide delay for mobile toolbar (ms) */
const TOOLBAR_AUTO_HIDE_MS = 3000;

/** Debounce delay for persisting reading position changes (ms) */
const POSITION_SAVE_DEBOUNCE_MS = 1000;

/** Typography overrides restored from dockview panel params */
export interface PanelTypographyParams {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  readerLayout?: ReaderLayout;
}

interface WorkspaceBookReaderProps {
  bookId: string;
  panelApi?: DockviewPanelApi;
  /** Initial typography overrides from restored panel params */
  panelTypography?: PanelTypographyParams;
  onRegisterNavigation?: (panelId: string, navigateToCfi: (cfi: string) => void) => void;
  onUnregisterNavigation?: (panelId: string) => void;
  onRegisterToc?: (panelId: string, toc: TocEntry[]) => void;
  onUnregisterToc?: (panelId: string) => void;
  onOpenNotebook?: () => void;
  onOpenChat?: () => void;
  onHighlightCreated?: (highlight: { highlightId: string; cfiRange: string; text: string }) => void;
  /** Shared ref for tracking current chapter position per book (for chat context) */
  chatContextMap?: React.MutableRefObject<
    Map<string, { currentChapterIndex: number; currentSpineHref: string; visibleText: string }>
  >;
  onRegisterTempHighlight?: (panelId: string, fn: (cfi: string) => void) => void;
  onUnregisterTempHighlight?: (panelId: string) => void;
}

export function WorkspaceBookReader({
  bookId,
  panelApi,
  panelTypography,
  onRegisterNavigation,
  onUnregisterNavigation,
  onRegisterToc,
  onUnregisterToc,
  onOpenNotebook,
  onOpenChat,
  onHighlightCreated,
  chatContextMap,
  onRegisterTempHighlight,
  onUnregisterTempHighlight,
}: WorkspaceBookReaderProps) {
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
    console.debug("[WorkspaceBookReader] placeholderNav called", {
      cfi,
      hasRealNav: !!realNavRef.current,
    });
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
    console.debug("[WorkspaceBookReader] registering placeholder nav", {
      id,
      bookId,
      panelApiId: panelApi?.id,
    });
    onRegisterNavigation?.(id, placeholderNav);
    return () => {
      onUnregisterNavigation?.(id);
    };
  }, [bookId, panelApi, placeholderNav, onRegisterNavigation, onUnregisterNavigation]);

  // Called by WorkspaceBookReaderInner once its rendition is ready
  const onRenditionReady = useCallback((nav: (cfi: string) => void) => {
    console.debug("[WorkspaceBookReader] onRenditionReady called, pending:", pendingCfiRef.current);
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
      onRegisterToc={onRegisterToc}
      onUnregisterToc={onUnregisterToc}
      onOpenNotebook={onOpenNotebook}
      onOpenChat={onOpenChat}
      onHighlightCreated={onHighlightCreated}
      chatContextMap={chatContextMap}
      onRegisterTempHighlight={onRegisterTempHighlight}
      onUnregisterTempHighlight={onUnregisterTempHighlight}
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
  onRegisterToc,
  onUnregisterToc,
  onOpenNotebook,
  onOpenChat,
  onHighlightCreated,
  chatContextMap,
  onRegisterTempHighlight,
  onUnregisterTempHighlight,
}: {
  book: BookMeta;
  panelApi?: DockviewPanelApi;
  panelTypography?: PanelTypographyParams;
  /** Whether the panel has been visible at least once (controlled by outer component) */
  hasBeenVisible: boolean;
  /** Called once the rendition is ready so the outer component can connect the real navigate callback */
  onRenditionReady?: (navigateToCfi: (cfi: string) => void) => void;
  onRegisterToc?: (panelId: string, toc: TocEntry[]) => void;
  onUnregisterToc?: (panelId: string) => void;
  onOpenNotebook?: () => void;
  onOpenChat?: () => void;
  onHighlightCreated?: (highlight: { highlightId: string; cfiRange: string; text: string }) => void;
  chatContextMap?: React.MutableRefObject<
    Map<string, { currentChapterIndex: number; currentSpineHref: string; visibleText: string }>
  >;
  onRegisterTempHighlight?: (panelId: string, fn: (cfi: string) => void) => void;
  onUnregisterTempHighlight?: (panelId: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

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

  const layoutRef = useRef(localReaderLayout);

  const typographyRef = useRef({
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
  });
  typographyRef.current = {
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
  };

  const [bookProgress, setBookProgress] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCfiRef = useRef<string | null>(null);

  // Mobile toolbar auto-hide
  const isMobile = useIsMobile();
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetToolbarTimer = useCallback(() => {
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    toolbarTimerRef.current = setTimeout(() => {
      setToolbarVisible(false);
    }, TOOLBAR_AUTO_HIDE_MS);
  }, []);

  /** Show toolbar and start auto-hide countdown (mobile only) */
  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    if (isMobile) resetToolbarTimer();
  }, [isMobile, resetToolbarTimer]);

  /** Toggle toolbar visibility (for center-tap on mobile) */
  const toggleToolbar = useCallback(() => {
    setToolbarVisible((prev) => {
      const next = !prev;
      if (next && isMobile) resetToolbarTimer();
      return next;
    });
  }, [isMobile, resetToolbarTimer]);

  // Start auto-hide timer on mount for mobile
  useEffect(() => {
    if (isMobile) {
      resetToolbarTimer();
    } else {
      // On desktop, ensure toolbar is always visible
      setToolbarVisible(true);
      if (toolbarTimerRef.current) {
        clearTimeout(toolbarTimerRef.current);
        toolbarTimerRef.current = null;
      }
    }
    return () => {
      if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    };
  }, [isMobile, resetToolbarTimer]);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    search: executeSearch,
    results: searchResults,
    currentIndex: searchIndex,
    next: searchNext,
    prev: searchPrev,
    clear: clearSearch,
  } = useBookSearch(bookRef);

  // Track previous search annotations so we can remove them
  const prevSearchCfisRef = useRef<string[]>([]);

  // Navigate to current search result when index changes
  useEffect(() => {
    if (searchResults.length > 0 && searchResults[searchIndex]) {
      renditionRef.current?.display(searchResults[searchIndex].cfi).catch((err: unknown) => {
        console.warn("Search navigation failed:", err);
      });
    }
  }, [searchIndex, searchResults]);

  // Apply/remove search highlight annotations in the epub
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Remove previous annotations
    for (const cfi of prevSearchCfisRef.current) {
      try {
        rendition.annotations.remove(cfi, "highlight");
      } catch {
        // annotation may not exist
      }
    }

    if (searchResults.length === 0) {
      prevSearchCfisRef.current = [];
      return;
    }

    // Add highlight annotations for all results
    const cfis: string[] = [];
    for (let i = 0; i < searchResults.length; i++) {
      const cfi = searchResults[i].cfi;
      cfis.push(cfi);
      const isCurrent = i === searchIndex;
      const className = isCurrent ? "search-hl-current" : "search-hl";
      try {
        rendition.annotations.highlight(cfi, {}, undefined, className, {
          fill: isCurrent ? "rgba(59, 130, 246, 0.6)" : "rgba(59, 130, 246, 0.25)",
          "fill-opacity": "1",
          "mix-blend-mode": "multiply",
        });
      } catch {
        // annotation may fail for invalid CFIs
      }
    }
    prevSearchCfisRef.current = cfis;
  }, [searchResults, searchIndex]);

  // Clear search when book changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clearSearch();
  }, [book.id, clearSearch]);

  const handleSearchOpen = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    clearSearch();
  }, [clearSearch]);

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      executeSearch(query);
    },
    [executeSearch],
  );

  // Ref for search open state (accessible in iframe keydown handler)
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;

  // Intercept Cmd/Ctrl+F on the parent document (when focus is outside the iframe)
  useEffect(() => {
    const handleFindShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        // Only intercept if this panel (or a descendant) has focus
        if (
          !panelRef.current?.contains(document.activeElement) &&
          document.activeElement !== panelRef.current
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleFindShortcut);
    return () => {
      document.removeEventListener("keydown", handleFindShortcut);
    };
  }, []);

  const flushPositionSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const cfi = latestCfiRef.current;
    if (cfi) {
      savePositionDualKey({
        panelId: panelApi?.id,
        bookId: book.id,
        cfi,
        savePosition: (key, val) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
          ),
      }).catch((err) => console.error("Failed to flush reading position:", err));
    }
  }, [book.id, panelApi?.id]);
  const [toc, setLocalToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi).catch((err: unknown) => {
      console.warn("CFI navigation failed:", err);
    });
  }, []);

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
    } catch (err) {
      console.debug("Temp highlight failed:", err);
    }
  }, []);

  // Register temp highlight callback
  useEffect(() => {
    const id = panelApi?.id ?? book.id;
    onRegisterTempHighlight?.(id, applyTempHighlight);
    return () => {
      onUnregisterTempHighlight?.(id);
    };
  }, [book.id, panelApi, applyTempHighlight, onRegisterTempHighlight, onUnregisterTempHighlight]);

  const {
    selectionPopover,
    editPopover,
    saveHighlight: saveHighlightFromPopover,
    deleteHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
  } = useHighlights({ bookId: book.id, renditionRef, containerRef });

  // Keep layoutRef in sync
  layoutRef.current = localReaderLayout;

  // Main epub lifecycle effect — deferred until panel has been visible
  useEffect(() => {
    if (!hasBeenVisible) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let epubBook: EpubBook | null = null;
    let rendition: Rendition | null = null;

    const init = async () => {
      // Load binary data on demand
      const bookData = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getBookData(book.id))),
      );
      if (cancelled) return;

      const opts = getRenditionOptions(localReaderLayout);
      epubBook = ePub(bookData);
      bookRef.current = epubBook;

      // Inject layout fix CSS via spine hooks — must run before iframe load
      // so epubjs textWidth() calculation sees corrected layout
      epubBook.spine.hooks.content.register((doc: Document, _section: any) => {
        const style = doc.createElement("style");
        style.textContent = `
        /* Prevent off-screen positioned elements from inflating pagination width */
        section[class*="titlepage"] h1,
        section[class*="titlepage"] p,
        section[class*="colophon"] h2,
        section[class*="imprint"] h2 {
          position: static !important;
          left: auto !important;
        }
        img {
          max-height: 95vh !important;
          max-width: 100% !important;
          object-fit: contain !important;
        }
      `;
        doc.head.appendChild(style);
      });

      rendition = epubBook.renderTo(el, {
        width: "100%",
        height: "100%",
        spread: opts.spread,
        flow: opts.flow,
        allowScriptedContent: true,
        ...("gap" in opts && { gap: opts.gap }),
      });
      renditionRef.current = rendition;

      // Inject Google Fonts and typography CSS into the epub iframe
      rendition.hooks.content.register((contents: any) => {
        const doc = contents.document;
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href =
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Literata:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Source+Serif+4:wght@400;500;600;700&display=swap";
        doc.head.appendChild(link);

        const style = doc.createElement("style");
        style.id = "reader-typography";
        style.textContent = getTypographyCss(
          typographyRef.current.fontFamily,
          typographyRef.current.fontSize,
          typographyRef.current.lineHeight,
        );
        doc.head.appendChild(style);

        const highlightStyle = doc.createElement("style");
        highlightStyle.id = "reader-highlights";
        highlightStyle.textContent = `
        .epubjs-hl {
          background-color: rgba(255, 213, 79, 0.4) !important;
          cursor: pointer;
        }
        .search-hl {
          background-color: rgba(59, 130, 246, 0.25) !important;
        }
        .search-hl-current {
          background-color: rgba(59, 130, 246, 0.6) !important;
        }
      `;
        doc.head.appendChild(highlightStyle);

        // Inject theme colors directly into the iframe (primary mechanism —
        // epubjs themes.register() can leave its style elements empty)
        const themeStyle = doc.createElement("style");
        themeStyle.id = "reader-theme-colors";
        themeStyle.textContent = getThemeColorCss(resolveTheme(settings.theme));
        doc.head.appendChild(themeStyle);

        // Forward arrow-key navigation and intercept Cmd/Ctrl+F from the epub iframe
        doc.addEventListener("keydown", (e: KeyboardEvent) => {
          // Intercept Cmd/Ctrl+F to open in-book search
          if ((e.metaKey || e.ctrlKey) && e.key === "f") {
            e.preventDefault();
            e.stopPropagation();
            setSearchOpen(true);
            return;
          }
          if (layoutRef.current === "scroll") return;
          if (e.key === "ArrowLeft") rendition!.prev();
          else if (e.key === "ArrowRight") rendition!.next();
        });
      });

      registerThemeColors(rendition);

      (async () => {
        await epubBook.ready;

        // Extract TOC from epub navigation
        const nav = epubBook.navigation;
        if (nav && nav.toc) {
          const mapToc = (items: any[]): TocEntry[] =>
            items.map((item) => ({
              label: item.label?.trim() ?? "",
              href: item.href ?? "",
              ...(item.subitems?.length ? { subitems: mapToc(item.subitems) } : {}),
            }));
          const tocData = mapToc(nav.toc);
          setLocalToc(tocData);
          onRegisterToc?.(panelApi?.id ?? book.id, tocData);
        }

        // Restore reading position: prefer in-memory CFI, then panel-specific
        // position (for refresh with restored layout), then book-level fallback.
        const startCfi = await resolveStartCfi({
          latestCfi: latestCfiRef.current,
          panelId: panelApi?.id,
          bookId: book.id,
          getPosition: (key) =>
            AppRuntime.runPromise(
              ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition(key))),
            ),
        });
        await rendition.display(startCfi || undefined);

        // Eagerly populate chatContextMap so the chat panel has context
        // even before the first 'relocated' event fires.
        if (chatContextMap) {
          let visibleText = "";
          try {
            const contents = (rendition as any).getContents?.() as any[];
            if (contents?.length > 0) {
              visibleText = contents
                .map((c: any) => c.document?.body?.textContent?.trim() ?? "")
                .filter(Boolean)
                .join("\n\n");
            }
          } catch {
            // fallback: no visible text
          }
          const loc = rendition.currentLocation() as any;
          if (loc?.start) {
            chatContextMap.current.set(book.id, {
              currentChapterIndex: loc.start.index ?? 0,
              currentSpineHref: loc.start.href ?? "",
              visibleText,
            });
          }
        }

        const effectiveTheme = resolveTheme(settings.theme);
        rendition.themes.select(effectiveTheme);

        // Load and apply existing highlights
        await loadAndApplyHighlights(rendition);

        // Register selection handler
        registerSelectionHandler(rendition);

        // Notify outer component that rendition is ready so any pending
        // CFI navigation (e.g. from chat panel click during load) can drain.
        onRenditionReady?.(navigateToCfi);

        try {
          const cachedLocations = await AppRuntime.runPromise(
            LocationCacheService.pipe(Effect.andThen((s) => s.getLocations(book.id))).pipe(
              Effect.catchAll(() => Effect.succeed(null)),
            ),
          );
          if (cachedLocations) {
            epubBook.locations.load(cachedLocations);
          } else {
            await epubBook.locations.generate(1500);
            const json = (epubBook.locations as any).save() as string;
            AppRuntime.runPromise(
              LocationCacheService.pipe(Effect.andThen((s) => s.saveLocations(book.id, json))),
            ).catch(console.error);
          }
          setTotalPages((epubBook.locations as any).total as number);
        } catch {
          // locations generation can fail silently
        }

        rendition.on(
          "relocated",
          (location: {
            start: {
              cfi: string;
              percentage: number;
              displayed: { page: number; total: number };
              index?: number;
              href?: string;
            };
          }) => {
            if (!renditionRef.current) return;
            // Flash toolbar on page navigation so user sees page number update
            showToolbar();
            setBookProgress(location.start.percentage * 100);
            const epubLocTotal = (bookRef.current?.locations as any)?.total as number | undefined;
            if (epubLocTotal && epubLocTotal > 0) {
              const locIndex = bookRef.current!.locations.locationFromCfi(location.start.cfi);
              if (typeof locIndex === "number" && locIndex >= 0) {
                setCurrentPage(locIndex + 1);
              } else {
                setCurrentPage(Math.max(1, Math.round(location.start.percentage * epubLocTotal)));
              }
              setTotalPages(epubLocTotal);
            }
            latestCfiRef.current = location.start.cfi;

            // Update chat context with current chapter position and visible text
            if (chatContextMap && location.start.index != null) {
              let visibleText = "";
              try {
                const contents = (renditionRef.current as any)?.getContents?.() as any[];
                if (contents?.length > 0) {
                  visibleText = contents
                    .map((c: any) => c.document?.body?.textContent?.trim() ?? "")
                    .filter(Boolean)
                    .join("\n\n");
                }
              } catch {
                // fallback: no visible text
              }

              chatContextMap.current.set(book.id, {
                currentChapterIndex: location.start.index,
                currentSpineHref: location.start.href ?? "",
                visibleText,
              });
            }

            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
              savePositionDualKey({
                panelId: panelApi?.id,
                bookId: book.id,
                cfi: location.start.cfi,
                savePosition: (key, val) =>
                  AppRuntime.runPromise(
                    ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
                  ),
              }).catch((err) => console.error("Failed to save reading position:", err));
            }, POSITION_SAVE_DEBOUNCE_MS);
          },
        );
      })();
    }; // end init()

    // Keyboard navigation scoped to this panel only
    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      // Only respond if this panel (or a descendant) has focus
      if (
        !panelRef.current?.contains(document.activeElement) &&
        document.activeElement !== panelRef.current
      )
        return;
      if (e.key === "ArrowLeft") rendition?.prev();
      else if (e.key === "ArrowRight") rendition?.next();
    };

    document.addEventListener("keydown", handleKeyDown);

    init().catch((err) => {
      if (!cancelled) console.error("Failed to load book data:", err);
    });

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown);
      flushPositionSave();
      onUnregisterToc?.(panelApi?.id ?? book.id);
      if (rendition) rendition.destroy();
      if (epubBook) epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [
    hasBeenVisible,
    book.id,
    localReaderLayout,
    loadAndApplyHighlights,
    registerSelectionHandler,
    onRegisterToc,
    onUnregisterToc,
    flushPositionSave,
  ]);

  // Theme sync
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Re-resolve and re-register theme colors (they may have been stale at init time,
    // or the CSS variables may have changed since the last theme switch)
    registerThemeColors(rendition);

    // Directly inject updated theme CSS into iframe documents (primary mechanism)
    const effectiveTheme = resolveTheme(settings.theme);
    injectThemeColors(rendition, effectiveTheme);

    rendition.themes.select(effectiveTheme);
  }, [settings.theme]);

  // Typography sync — uses per-panel local state
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const css = getTypographyCss(localFontFamily, localFontSize, localLineHeight);
    const contents = (rendition as any).getContents() as any[];
    contents.forEach((content: any) => {
      const doc = content.document;
      if (!doc) return;
      let style = doc.getElementById("reader-typography");
      if (!style) {
        style = doc.createElement("style");
        style.id = "reader-typography";
        doc.head.appendChild(style);
      }
      style.textContent = css;
    });
  }, [localFontFamily, localFontSize, localLineHeight]);

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
        (renditionRef.current as any).resize();
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
        (renditionRef.current as any).resize();
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
    if (highlight) {
      onHighlightCreated?.({
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      });
    }
  }, [saveHighlightFromPopover, onHighlightCreated]);

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
            className={cn("h-full overflow-hidden", { "px-8 pt-10 pb-4": localReaderLayout })}
          />
          {isMobile && !isScrollMode && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              <button
                type="button"
                aria-label="Previous page"
                className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 appearance-none border-none bg-transparent p-0 active:bg-black/5 dark:active:bg-white/5"
                onPointerUp={handlePrev}
              />
              <button
                type="button"
                aria-label="Toggle toolbar"
                className="pointer-events-auto absolute top-0 left-1/4 h-full w-1/2 appearance-none border-none bg-transparent p-0"
                onPointerUp={toggleToolbar}
              />
              <button
                type="button"
                aria-label="Next page"
                className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 appearance-none border-none bg-transparent p-0 active:bg-black/5 dark:active:bg-white/5"
                onPointerUp={handleNext}
              />
            </div>
          )}
        </div>
        <div
          className={cn(
            "relative flex items-center justify-center border-t px-2 h-10 transition-all duration-300 ease-in-out",
            {
              "max-h-0 overflow-hidden border-t-0 opacity-0": isMobile && !toolbarVisible,
              "max-h-10 opacity-100": !isMobile || toolbarVisible,
            },
          )}
        >
          <div className="absolute left-2 flex items-center gap-1.5">
            {totalPages !== null && currentPage !== null ? (
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
            <div className="flex items-center gap-4">
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
            {onOpenNotebook && (
              <Button variant="ghost" size="icon" onClick={onOpenNotebook} title="Open Notebook">
                <Notebook className="size-4" />
                <span className="sr-only">Open Notebook</span>
              </Button>
            )}
            {onOpenChat && (
              <Button variant="ghost" size="icon" onClick={onOpenChat} title="Chat about book">
                <MessageSquare className="size-4" />
                <span className="sr-only">Chat about book</span>
              </Button>
            )}
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
                        renditionRef.current?.display(href).catch((err: unknown) => {
                          console.warn("TOC navigation failed:", err);
                        });
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
        {editPopover &&
          createPortal(
            <HighlightPopover
              mode="edit"
              position={editPopover.position}
              selectedText={editPopover.highlight.text}
              onDelete={deleteHighlightFromPopover}
              onDismiss={dismissPopovers}
            />,
            document.body,
          )}
      </div>
    </div>
  );
}
