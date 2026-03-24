import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, TableOfContents } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import { Effect } from "effect";
import { BookService, type Book } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/lib/use-highlights";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";
import { resolveThemeColors } from "~/lib/epub-theme-utils";
import type { DockviewPanelApi } from "dockview";
import type { TocEntry } from "~/lib/reader-context";

interface WorkspaceBookReaderProps {
  bookId: string;
  panelApi?: DockviewPanelApi;
  onRegisterNavigation?: (bookId: string, navigateToCfi: (cfi: string) => void) => void;
  onUnregisterNavigation?: (bookId: string) => void;
  onRegisterToc?: (bookId: string, toc: TocEntry[]) => void;
  onUnregisterToc?: (bookId: string) => void;
  onOpenNotebook?: () => void;
  onHighlightCreated?: (highlight: { highlightId: string; cfiRange: string; text: string }) => void;
}

function getFontFallback(fontFamily: string): string {
  if (fontFamily === "Geist") return "sans-serif";
  if (fontFamily === "Geist Mono") return "monospace";
  if (fontFamily === "Berkeley Mono") return "monospace";
  return "serif";
}

function getTypographyCss(fontFamily: string, fontSize: number, lineHeight: number): string {
  const fallback = getFontFallback(fontFamily);
  return `
    @font-face {
      font-family: "Geist";
      src: url("/fonts/Geist[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    @font-face {
      font-family: "Geist Mono";
      src: url("/fonts/GeistMono[wght].woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    @font-face {
      font-family: "Berkeley Mono";
      src: url("/fonts/BerkeleyMonoVariable.woff2") format("woff2");
      font-weight: 100 900;
      font-display: swap;
    }
    * {
      font-family: "${fontFamily}", ${fallback} !important;
      font-size: ${fontSize}% !important;
      line-height: ${lineHeight} !important;
    }
  `;
}



function getRenditionOptions(layout: ReaderLayout) {
  switch (layout) {
    case "spread":
      return { spread: "always" as const, flow: "paginated" as const, gap: 64 };
    case "scroll":
      return { spread: "none" as const, flow: "scrolled-doc" as const };
    case "single":
    default:
      return { spread: "none" as const, flow: "paginated" as const };
  }
}

export function WorkspaceBookReader({ bookId, panelApi, onRegisterNavigation, onUnregisterNavigation, onRegisterToc, onUnregisterToc, onOpenNotebook, onHighlightCreated }: WorkspaceBookReaderProps) {
  // Load book data via useEffectQuery
  const { data: book, error, isLoading } = useEffectQuery(
    () =>
      BookService.pipe(
        Effect.andThen((s) => s.getBook(bookId)),
        Effect.catchTag("BookNotFoundError", () => Effect.succeed(null as Book | null)),
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

  return <WorkspaceBookReaderInner book={book} panelApi={panelApi} onRegisterNavigation={onRegisterNavigation} onUnregisterNavigation={onUnregisterNavigation} onRegisterToc={onRegisterToc} onUnregisterToc={onUnregisterToc} onOpenNotebook={onOpenNotebook} onHighlightCreated={onHighlightCreated} />;
}

/**
 * Inner component that renders once we have book data.
 * Manages its own epub lifecycle, TOC state, and keyboard navigation.
 */
function WorkspaceBookReaderInner({ book, panelApi, onRegisterNavigation, onUnregisterNavigation, onRegisterToc, onUnregisterToc, onOpenNotebook, onHighlightCreated }: { book: Book; panelApi?: DockviewPanelApi; onRegisterNavigation?: (bookId: string, navigateToCfi: (cfi: string) => void) => void; onUnregisterNavigation?: (bookId: string) => void; onRegisterToc?: (bookId: string, toc: TocEntry[]) => void; onUnregisterToc?: (bookId: string) => void; onOpenNotebook?: () => void; onHighlightCreated?: (highlight: { highlightId: string; cfiRange: string; text: string }) => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const [settings, updateSettings] = useSettings();
  const layoutRef = useRef(settings.readerLayout);

  // Defer epub initialization until the panel has been visible at least once.
  // With renderer: "always", background tabs exist in the DOM but have zero
  // dimensions. epubjs renderTo() on a zero-sized container produces broken layout.
  const [hasBeenVisible, setHasBeenVisible] = useState(() => panelApi ? panelApi.isVisible : true);

  useEffect(() => {
    if (!panelApi || hasBeenVisible) return;
    // Already visible on mount (race with state init)
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
  const typographyRef = useRef({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  });
  typographyRef.current = {
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
  };

  const [bookProgress, setBookProgress] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toc, setLocalToc] = useState<TocEntry[]>([]);
  const [tocOpen, setTocOpen] = useState(false);

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi).catch((err: unknown) => {
      console.warn("CFI navigation failed:", err);
    });
  }, []);

  // Register navigateToCfi with parent workspace for cross-panel coordination
  useEffect(() => {
    onRegisterNavigation?.(book.id, navigateToCfi);
    return () => {
      onUnregisterNavigation?.(book.id);
    };
  }, [book.id, navigateToCfi, onRegisterNavigation, onUnregisterNavigation]);

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
  layoutRef.current = settings.readerLayout;

  // Main epub lifecycle effect — deferred until panel has been visible
  useEffect(() => {
    if (!hasBeenVisible) return;
    const el = containerRef.current;
    if (!el) return;

    const opts = getRenditionOptions(settings.readerLayout);
    const epubBook = ePub(book.data);
    bookRef.current = epubBook;

    const rendition = epubBook.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: opts.spread,
      flow: opts.flow,
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
      `;
      doc.head.appendChild(highlightStyle);
    });

    const lightColors = resolveThemeColors("light");
    const darkColors = resolveThemeColors("dark");

    rendition.themes.register("light", {
      body: { color: `${lightColors.foreground} !important`, background: `${lightColors.background} !important` },
      a: { color: "inherit !important" },
    });
    rendition.themes.register("dark", {
      body: { color: `${darkColors.foreground} !important`, background: `${darkColors.background} !important` },
      a: { color: "inherit !important" },
    });

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
        onRegisterToc?.(book.id, tocData);
      }

      // Restore saved reading position
      const savedCfi = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getPosition(book.id))),
      );
      await rendition.display(savedCfi || undefined);

      const effectiveTheme = resolveTheme(settings.theme);
      rendition.themes.select(effectiveTheme);

      // Load and apply existing highlights
      await loadAndApplyHighlights(rendition);

      // Register selection handler
      registerSelectionHandler(rendition);

      try {
        const cachedLocations = await AppRuntime.runPromise(
          BookService.pipe(Effect.andThen((s) => s.getLocations(book.id))).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          ),
        );
        if (cachedLocations) {
          epubBook.locations.load(cachedLocations);
        } else {
          await epubBook.locations.generate(1500);
          const json = (epubBook.locations as any).save() as string;
          AppRuntime.runPromise(
            BookService.pipe(Effect.andThen((s) => s.saveLocations(book.id, json))),
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
          };
        }) => {
          if (!renditionRef.current) return;
          const { page, total } = location.start.displayed;
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
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            AppRuntime.runPromise(
              BookService.pipe(Effect.andThen((s) => s.savePosition(book.id, location.start.cfi))),
            ).catch((err) => console.error("Failed to save reading position:", err));
          }, 1000);
        },
      );
    })();

    // Keyboard navigation scoped to this panel only
    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      // Only respond if this panel (or a descendant) has focus
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== panelRef.current) return;
      if (e.key === "ArrowLeft") rendition.prev();
      else if (e.key === "ArrowRight") rendition.next();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      onUnregisterToc?.(book.id);
      rendition.destroy();
      epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [hasBeenVisible, book.id, book.data, settings.readerLayout, loadAndApplyHighlights, registerSelectionHandler, onRegisterToc, onUnregisterToc]);

  // Theme sync
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Re-resolve and re-register theme colors (they may have been stale at init time,
    // or the CSS variables may have changed since the last theme switch)
    const lightColors = resolveThemeColors("light");
    const darkColors = resolveThemeColors("dark");

    rendition.themes.register("light", {
      body: { color: `${lightColors.foreground} !important`, background: `${lightColors.background} !important` },
      a: { color: "inherit !important" },
    });
    rendition.themes.register("dark", {
      body: { color: `${darkColors.foreground} !important`, background: `${darkColors.background} !important` },
      a: { color: "inherit !important" },
    });

    rendition.themes.select(resolveTheme(settings.theme));
  }, [settings.theme]);

  // Typography sync
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const css = getTypographyCss(settings.fontFamily, settings.fontSize, settings.lineHeight);
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
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

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
      const lightColors = resolveThemeColors("light");
      const darkColors = resolveThemeColors("dark");

      rendition.themes.register("light", {
        body: { color: `${lightColors.foreground} !important`, background: `${lightColors.background} !important` },
        a: { color: "inherit !important" },
      });
      rendition.themes.register("dark", {
        body: { color: `${darkColors.foreground} !important`, background: `${darkColors.background} !important` },
        a: { color: "inherit !important" },
      });

      rendition.themes.select(resolveTheme(settings.theme));

      // Resize in case container dimensions changed
      requestAnimationFrame(() => {
        (rendition as any)?.resize();
      });
    };

    const visDisposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) handleBecameVisible();
    });

    const activeDisposable = panelApi.onDidActiveChange((e) => {
      if (e.isActive) handleBecameVisible();
    });

    return () => {
      visDisposable.dispose();
      activeDisposable.dispose();
    };
  }, [panelApi, settings.theme]);

  const handlePrev = useCallback(() => renditionRef.current?.prev(), []);
  const handleNext = useCallback(() => renditionRef.current?.next(), []);

  const handleUpdateSettings = useCallback(
    (update: Partial<typeof settings>) => {
      if (update.readerLayout && update.readerLayout !== settings.readerLayout) {
        const cfi = renditionRef.current?.location?.start?.cfi;
        updateSettings(update);
        if (cfi) queueMicrotask(() => renditionRef.current?.display(cfi));
        return;
      }
      updateSettings(update);
    },
    [settings.readerLayout, updateSettings],
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

  const isScrollMode = settings.readerLayout === "scroll";

  return (
    <div
      ref={panelRef}
      className="flex h-full outline-none"
      tabIndex={0}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={containerRef} className={cn("flex-1 overflow-hidden", { "px-8 pt-10 pb-4": settings.readerLayout })} />
        <div className="relative flex items-center justify-center border-t px-2 h-10">
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
            {onOpenNotebook && (
              <Button variant="ghost" size="icon" onClick={onOpenNotebook} title="Open Notebook">
                <Notebook className="size-4" />
                <span className="sr-only">Open Notebook</span>
              </Button>
            )}
            {toc.length > 0 && (
              <Popover open={tocOpen} onOpenChange={setTocOpen}>
                <PopoverTrigger
                  render={
                    <Button variant="ghost" size="icon" title="Table of Contents" />
                  }
                >
                  <TableOfContents className="size-4" />
                  <span className="sr-only">Table of Contents</span>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" sideOffset={8} className="max-h-80 w-64 overflow-y-auto p-1.5">
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Table of Contents</p>
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
            <ReaderSettingsMenu settings={settings} onUpdateSettings={handleUpdateSettings} />
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
