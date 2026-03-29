import { useEffect, useRef, useCallback, useState } from "react";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, Search, TableOfContents } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import { Effect } from "effect";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { LocationCacheService } from "~/lib/location-cache-store";
import { ReadingPositionService } from "~/lib/position-store";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { AnnotationsPanel } from "~/components/annotations-panel";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/lib/use-highlights";
import { useReaderNavigation, type TocEntry } from "~/lib/reader-context";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";
import { cn } from "~/lib/utils";
import { registerThemeColors, getThemeColorCss, injectThemeColors } from "~/lib/epub-theme-utils";
import { useBookSearch } from "~/lib/use-book-search";
import { SearchBar } from "~/components/search-bar";

/** Debounce delay for persisting reading position changes (ms) */
const POSITION_SAVE_DEBOUNCE_MS = 1000;

interface BookReaderProps {
  book: BookMeta;
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

export function BookReader({ book }: BookReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [settings, updateSettings] = useSettings();
  const layoutRef = useRef(settings.readerLayout);
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
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [pendingHighlight, setPendingHighlight] = useState<HighlightReferenceAttrs | null>(null);
  const { toc, navigateToHref, setToc, setNavigateToHref } = useReaderNavigation();
  const [tocOpen, setTocOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const {
    search,
    results,
    currentIndex,
    next: searchNext,
    prev: searchPrev,
    clear: searchClear,
  } = useBookSearch(bookRef);

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi).catch((err: unknown) => {
      console.warn("CFI navigation failed:", err);
    });
  }, []);

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

  useEffect(() => {
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

      const opts = getRenditionOptions(settings.readerLayout);
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

        // Forward arrow-key navigation from the epub iframe
        doc.addEventListener("keydown", (e: KeyboardEvent) => {
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
          setToc(mapToc(nav.toc));
        }

        // Provide chapter navigation via rendition.display
        setNavigateToHref((href: string) => {
          rendition!.display(href).catch((err: unknown) => {
            console.warn("TOC navigation failed:", err);
          });
        });

        const savedCfi = await AppRuntime.runPromise(
          ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition(book.id))),
        );
        await rendition.display(savedCfi || undefined);

        const effectiveTheme = resolveTheme(settings.theme);
        rendition.themes.select(effectiveTheme);

        // Load and apply existing highlights via the hook
        await loadAndApplyHighlights(rendition);

        // Register selection handler via the hook
        registerSelectionHandler(rendition);

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
            };
          }) => {
            if (!renditionRef.current) return;
            setBookProgress(location.start.percentage * 100);
            // Compute current page from locations if available
            const epubLocTotal = (bookRef.current?.locations as any)?.total as number | undefined;
            if (epubLocTotal && epubLocTotal > 0) {
              const locIndex = bookRef.current!.locations.locationFromCfi(location.start.cfi);
              if (typeof locIndex === "number" && locIndex >= 0) {
                setCurrentPage(locIndex + 1);
              } else {
                // Fallback: derive from percentage
                setCurrentPage(Math.max(1, Math.round(location.start.percentage * epubLocTotal)));
              }
              setTotalPages(epubLocTotal);
            }
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
              AppRuntime.runPromise(
                ReadingPositionService.pipe(
                  Effect.andThen((s) => s.savePosition(book.id, location.start.cfi)),
                ),
              ).catch((err) => console.error("Failed to save reading position:", err));
            }, POSITION_SAVE_DEBOUNCE_MS);
          },
        );
      })();
    }; // end init()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setToc([]);
      setNavigateToHref(() => {});
      if (rendition) rendition.destroy();
      if (epubBook) epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [
    book.id,
    settings.readerLayout,
    loadAndApplyHighlights,
    registerSelectionHandler,
    setToc,
    setNavigateToHref,
  ]);

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

  useEffect(() => {
    const timer = setTimeout(() => {
      (renditionRef.current as any)?.resize();
    }, 350);
    return () => clearTimeout(timer);
  }, [annotationsPanelOpen]);

  // Track previous search annotations so we can remove them
  const prevSearchCfisRef = useRef<string[]>([]);

  // Navigate to the current search result when it changes
  useEffect(() => {
    if (results.length > 0 && results[currentIndex]) {
      renditionRef.current?.display(results[currentIndex].cfi).catch((err: unknown) => {
        console.warn("Search navigation failed:", err);
      });
    }
  }, [results, currentIndex]);

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

    if (results.length === 0) {
      prevSearchCfisRef.current = [];
      return;
    }

    // Add highlight annotations for all results
    const cfis: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const cfi = results[i].cfi;
      cfis.push(cfi);
      const isCurrent = i === currentIndex;
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
  }, [results, currentIndex]);

  // Clear search state when book changes
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    searchClear();
  }, [book.id, searchClear]);

  // Intercept Cmd/Ctrl+F in parent page and epub iframe
  useEffect(() => {
    const handleFindShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleFindShortcut);

    // Also intercept in the epub iframe
    const rendition = renditionRef.current;
    const contents = (rendition as any)?.getContents?.() as any[] | undefined;
    contents?.forEach((content: any) => {
      content.document?.addEventListener("keydown", handleFindShortcut);
    });

    return () => {
      document.removeEventListener("keydown", handleFindShortcut);
      contents?.forEach((content: any) => {
        content.document?.removeEventListener("keydown", handleFindShortcut);
      });
    };
  }, []);

  // Re-register Cmd/Ctrl+F handler in iframe when content changes
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    const registerHandler = (contents: any) => {
      const doc = contents.document;
      if (!doc) return;
      const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "f") {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(true);
        }
      };
      doc.addEventListener("keydown", handler);
      (contents as any).__searchHandler = handler;
    };

    rendition.hooks.content.register(registerHandler);
  }, []);

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      search(query);
    },
    [search],
  );

  const handleSearchClose = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    searchClear();
  }, [searchClear]);

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
      const attrs: HighlightReferenceAttrs = {
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      };

      // If the editor is already mounted, append directly
      if (editorRef.current) {
        editorRef.current.appendHighlightReference(attrs);
      } else {
        // Queue the highlight and open the panel — the useEffect below
        // will flush it once the editor mounts
        setPendingHighlight(attrs);
      }

      // Always ensure the panel is open
      setAnnotationsPanelOpen(true);
    }
  }, [saveHighlightFromPopover]);

  // Flush pending highlight once the editor is mounted
  useEffect(() => {
    if (pendingHighlight && editorRef.current) {
      editorRef.current.appendHighlightReference(pendingHighlight);
      setPendingHighlight(null);
    }
  });

  const isScrollMode = settings.readerLayout === "scroll";

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex-1 overflow-hidden">
          {searchOpen && (
            <div className="absolute top-0 right-0 left-0 z-10">
              <SearchBar
                query={searchQuery}
                onQueryChange={handleSearchQueryChange}
                resultCount={results.length}
                currentIndex={currentIndex}
                onNext={searchNext}
                onPrev={searchPrev}
                onClose={handleSearchClose}
              />
            </div>
          )}
          <div
            ref={containerRef}
            className={cn("h-full overflow-hidden", {
              "px-4 pt-6 pb-2 md:px-8 md:pt-10 md:pb-4": settings.readerLayout,
            })}
          />
        </div>
        <div className="flex items-center justify-between border-t px-2 min-h-14 md:min-h-10 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center gap-1.5">
            {totalPages !== null && currentPage !== null ? (
              <span className="text-muted-foreground text-[10px] tabular-nums md:text-xs">
                Page {currentPage} of {totalPages}
              </span>
            ) : (
              <span className="text-muted-foreground text-[10px] tabular-nums md:text-xs">
                {Math.round(bookProgress)}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-0 md:gap-1">
            {!isScrollMode && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden size-10 md:flex md:size-8"
                  onClick={handlePrev}
                >
                  <ChevronLeft className="size-5 md:size-4" />
                  <span className="sr-only">Previous page</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden size-10 md:flex md:size-8"
                  onClick={handleNext}
                >
                  <ChevronRight className="size-5 md:size-4" />
                  <span className="sr-only">Next page</span>
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-10 md:size-8"
              onClick={() => setSearchOpen((prev) => !prev)}
              title="Search in book (Cmd+F)"
            >
              <Search className="size-5 md:size-4" />
              <span className="sr-only">Search in book</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 md:size-8"
              onClick={() => setAnnotationsPanelOpen(!annotationsPanelOpen)}
              title="Toggle notebook"
            >
              <Notebook className="size-5 md:size-4" />
              <span className="sr-only">Toggle notebook</span>
            </Button>
            {toc.length > 0 && (
              <Popover open={tocOpen} onOpenChange={setTocOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 md:size-8"
                      title="Table of Contents"
                    />
                  }
                >
                  <TableOfContents className="size-5 md:size-4" />
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
                        navigateToHref(href);
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
        {selectionPopover && (
          <HighlightPopover
            position={selectionPopover.position}
            selectedText={selectionPopover.text}
            onSave={handleSaveHighlight}
            onDismiss={dismissPopovers}
          />
        )}
        {editPopover && (
          <HighlightPopover
            mode="edit"
            position={editPopover.position}
            selectedText={editPopover.highlight.text}
            onDelete={deleteHighlightFromPopover}
            onDismiss={dismissPopovers}
          />
        )}
      </div>
      <AnnotationsPanel
        bookId={book.id}
        bookTitle={book.title}
        isOpen={annotationsPanelOpen}
        onClose={() => setAnnotationsPanelOpen(false)}
        onNavigateToCfi={navigateToCfi}
        editorRef={editorRef}
      />
    </div>
  );
}
