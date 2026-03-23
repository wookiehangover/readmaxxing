import { useEffect, useRef, useCallback, useState } from "react";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import { Effect } from "effect";
import { BookService, type Book } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { RadialProgress } from "~/components/radial-progress";
import { AnnotationsPanel } from "~/components/annotations-panel";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/lib/use-highlights";
import { useReaderNavigation, type TocEntry } from "~/lib/reader-context";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";
import { cn } from "~/lib/utils"

interface BookReaderProps {
  book: Book;
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

function resolveThemeColors(mode: "light" | "dark") {
  const root = document.documentElement;
  const currentlyDark = root.classList.contains("dark");
  const needsDark = mode === "dark";

  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", needsDark);
  }

  const computed = getComputedStyle(root);
  const background = computed.getPropertyValue("--background").trim();
  const foreground = computed.getPropertyValue("--foreground").trim();

  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", currentlyDark);
  }

  return { background, foreground };
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
  const [chapterProgress, setChapterProgress] = useState(0);
  const [bookProgress, setBookProgress] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [pendingHighlight, setPendingHighlight] = useState<HighlightReferenceAttrs | null>(null);
  const { setToc, setNavigateToHref } = useReaderNavigation();

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi);
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
        setToc(mapToc(nav.toc));
      }

      // Provide chapter navigation via rendition.display
      setNavigateToHref((href: string) => {
        rendition.display(href);
      });

      const savedCfi = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getPosition(book.id))),
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
          BookService.pipe(Effect.andThen((s) => s.getLocations(book.id))).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )
        );
        if (cachedLocations) {
          epubBook.locations.load(cachedLocations);
        } else {
          await epubBook.locations.generate(1500);
          const json = (epubBook.locations as any).save() as string;
          AppRuntime.runPromise(
            BookService.pipe(Effect.andThen((s) => s.saveLocations(book.id, json)))
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
          setChapterProgress(total > 0 ? (page / total) * 100 : 0);
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
              BookService.pipe(Effect.andThen((s) => s.savePosition(book.id, location.start.cfi))),
            ).catch((err) => console.error("Failed to save reading position:", err));
          }, 1000);
        },
      );
    })();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      if (e.key === "ArrowLeft") rendition.prev();
      else if (e.key === "ArrowRight") rendition.next();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setToc([]);
      setNavigateToHref(() => {});
      rendition.destroy();
      epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book.id, book.data, settings.readerLayout, loadAndApplyHighlights, registerSelectionHandler, setToc, setNavigateToHref]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.select(resolveTheme(settings.theme));
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
        <div ref={containerRef} className={cn("flex-1 overflow-hidden", { "px-8 pt-10 pb-4": settings.readerLayout })} />
        <div className="relative flex items-center justify-center border-t px-2 h-10">
          <div className="absolute left-2 flex items-center gap-1.5">
            <RadialProgress value={chapterProgress} label="Chapter" />
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
              onClick={() => setAnnotationsPanelOpen(!annotationsPanelOpen)}
              title="Toggle notebook"
            >
              <NotebookPen className="size-4" />
              <span className="sr-only">Toggle notebook</span>
            </Button>
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
