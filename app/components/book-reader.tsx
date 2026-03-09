import { useEffect, useRef, useCallback, useState } from "react";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import type { Book } from "~/lib/book-store";
import { savePosition, getPosition } from "~/lib/book-store";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { RadialProgress } from "~/components/radial-progress";
import { AnnotationsPanel } from "~/components/annotations-panel";
import {
  saveHighlight,
  getHighlightsByBook,
  updateHighlight,
  deleteHighlight,
  type Highlight,
} from "~/lib/annotations-store";
import { HighlightPopover } from "~/components/highlight-popover";

interface BookReaderProps {
  book: Book;
}

function getFontFallback(fontFamily: string): string {
  if (fontFamily === "Geist") return "sans-serif";
  if (fontFamily === "Geist Mono") return "monospace";
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
      return { spread: "always" as const, flow: "paginated" as const };
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
  const typographyRef = useRef({ fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: settings.lineHeight });
  typographyRef.current = { fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: settings.lineHeight };
  const [chapterProgress, setChapterProgress] = useState(0);
  const [bookProgress, setBookProgress] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi);
  }, []);

  // Highlight storage ref for click-callback lookups
  const highlightsRef = useRef<Map<string, Highlight>>(new Map());

  // Highlight selection state (for creating new highlights)
  const [selectionPopover, setSelectionPopover] = useState<{
    position: { x: number; y: number };
    cfiRange: string;
    text: string;
  } | null>(null);

  // Edit popover state (for editing/deleting existing highlights)
  const [editPopover, setEditPopover] = useState<{
    position: { x: number; y: number };
    highlight: Highlight;
  } | null>(null);

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

      // Typography style injection
      const style = doc.createElement("style");
      style.id = "reader-typography";
      style.textContent = getTypographyCss(typographyRef.current.fontFamily, typographyRef.current.fontSize, typographyRef.current.lineHeight);
      doc.head.appendChild(style);

      // Highlight overlay styles
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

    // Register light and dark themes for epub iframe content
    rendition.themes.register("light", {
      body: { color: "#1a1a1a !important", background: "#ffffff !important" },
      a: { color: "inherit !important" },
    });
    rendition.themes.register("dark", {
      body: { color: "#e0e0e0 !important", background: "#1a1a1a !important" },
      a: { color: "inherit !important" },
    });

    // Async setup: ensure proper ordering of book ready, display, themes, and locations
    (async () => {
      await epubBook.ready;

      const savedCfi = await getPosition(book.id);
      await rendition.display(savedCfi || undefined);

      // Apply theme and typography AFTER content is rendered
      const effectiveTheme = resolveTheme(settings.theme);
      rendition.themes.select(effectiveTheme);

      // Load and re-apply existing highlights
      try {
        const existingHighlights = await getHighlightsByBook(book.id);
        const hlMap = new Map<string, Highlight>();
        for (const hl of existingHighlights) {
          hlMap.set(hl.cfiRange, hl);
          rendition.annotations.highlight(
            hl.cfiRange,
            {},
            (e: MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              const stored = highlightsRef.current.get(hl.cfiRange);
              if (!stored) return;

              const target = e.target as Element;
              const targetRect = target.getBoundingClientRect();
              let x: number;
              let y: number;

              if (targetRect.width > 0 && targetRect.height > 0) {
                // Check if callback fired in parent context or iframe context
                const isParentContext = e.view === window;
                if (isParentContext) {
                  // targetRect is already in parent coordinates
                  x = targetRect.left + targetRect.width / 2;
                  y = targetRect.bottom;
                } else {
                  // targetRect is iframe-relative, need to offset
                  const iframe = containerRef.current?.querySelector("iframe");
                  if (!iframe) return;
                  const iframeRect = iframe.getBoundingClientRect();
                  x = iframeRect.left + targetRect.left + targetRect.width / 2;
                  y = iframeRect.top + targetRect.bottom;
                }
              } else {
                // Fallback to mouse coordinates
                const iframe = containerRef.current?.querySelector("iframe");
                if (!iframe) return;
                const iframeRect = iframe.getBoundingClientRect();
                const isParentContext = e.view === window;
                if (isParentContext) {
                  x = e.clientX;
                  y = e.clientY;
                } else {
                  x = iframeRect.left + e.clientX;
                  y = iframeRect.top + e.clientY;
                }
              }

              setEditPopover({
                position: { x, y },
                highlight: stored,
              });
              setSelectionPopover(null);
            },
            "epubjs-hl",
            { fill: hl.color || "rgba(255, 213, 79, 0.4)" },
          );
        }
        highlightsRef.current = hlMap;
      } catch {
        // Highlight loading can fail silently
      }

      // Listen for text selection in the epub iframe
      rendition.on("selected", (cfiRange: string, contents: any) => {
        if (!renditionRef.current) return;

        // Get the selected text
        const range = contents.range(cfiRange);
        const text = range?.toString() || "";
        if (!text.trim()) return;

        // Calculate position relative to the parent window
        const iframe = contents.document?.defaultView?.frameElement;
        if (!iframe) return;
        const iframeRect = iframe.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();

        const x = iframeRect.left + rangeRect.left + rangeRect.width / 2;
        const y = iframeRect.top + rangeRect.bottom;

        setSelectionPopover({ position: { x, y }, cfiRange, text });
      });

      // Generate locations in background for progress tracking
      try {
        epubBook.locations.generate(1024);
      } catch {
        // locations generation can fail silently — progress will show 0%
      }

      // Track progress and save position on navigation
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

          // Chapter progress
          const { page, total } = location.start.displayed;
          setChapterProgress(total > 0 ? (page / total) * 100 : 0);

          // Overall book progress (available once locations are generated)
          setBookProgress(location.start.percentage * 100);

          // Debounce-save position to IndexedDB
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = setTimeout(() => {
            savePosition(book.id, location.start.cfi);
          }, 1000);
        },
      );
    })();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      if (e.key === "ArrowLeft") {
        rendition.prev();
      } else if (e.key === "ArrowRight") {
        rendition.next();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      rendition.destroy();
      epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [book.id, book.data, settings.readerLayout]);

  // React to theme changes without recreating the rendition
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const effectiveTheme = resolveTheme(settings.theme);
    rendition.themes.select(effectiveTheme);
  }, [settings.theme]);

  // React to typography changes by updating injected style tags in rendered iframes
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const css = getTypographyCss(settings.fontFamily, settings.fontSize, settings.lineHeight);

    // Update style in all currently rendered content views
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

  // Resize rendition when annotations panel opens/closes
  useEffect(() => {
    const timer = setTimeout(() => {
      (renditionRef.current as any)?.resize();
    }, 350);
    return () => clearTimeout(timer);
  }, [annotationsPanelOpen]);


  const handlePrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const handleNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const handleUpdateSettings = useCallback(
    (update: Partial<typeof settings>) => {
      // If layout is changing, save current location before switching
      if (update.readerLayout && update.readerLayout !== settings.readerLayout) {
        const currentLocation = renditionRef.current?.location;
        const cfi = currentLocation?.start?.cfi;

        updateSettings(update);

        if (cfi) {
          queueMicrotask(() => {
            renditionRef.current?.display(cfi);
          });
        }
        return;
      }

      updateSettings(update);
    },
    [settings.readerLayout, updateSettings],
  );

  const isScrollMode = settings.readerLayout === "scroll";

  const handleSaveHighlight = useCallback(
    async (note: string) => {
      if (!selectionPopover || !renditionRef.current) return;

      const { cfiRange, text } = selectionPopover;
      const color = "rgba(255, 213, 79, 0.4)";

      const highlight: Highlight = {
        id: crypto.randomUUID(),
        bookId: book.id,
        cfiRange,
        text,
        note,
        color,
        createdAt: Date.now(),
      };

      await saveHighlight(highlight);

      // Store in ref for click-callback lookups
      highlightsRef.current.set(cfiRange, highlight);

      // Render the highlight in the epub with click callback
      renditionRef.current.annotations.highlight(
        cfiRange,
        {},
        (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const stored = highlightsRef.current.get(cfiRange);
          if (!stored) return;
          const target = e.target as Element;
          const targetRect = target.getBoundingClientRect();
          let x: number;
          let y: number;

          if (targetRect.width > 0 && targetRect.height > 0) {
            const isParentContext = e.view === window;
            if (isParentContext) {
              x = targetRect.left + targetRect.width / 2;
              y = targetRect.bottom;
            } else {
              const iframe = containerRef.current?.querySelector("iframe");
              if (!iframe) return;
              const iframeRect = iframe.getBoundingClientRect();
              x = iframeRect.left + targetRect.left + targetRect.width / 2;
              y = iframeRect.top + targetRect.bottom;
            }
          } else {
            const iframe = containerRef.current?.querySelector("iframe");
            if (!iframe) return;
            const iframeRect = iframe.getBoundingClientRect();
            const isParentContext = e.view === window;
            if (isParentContext) {
              x = e.clientX;
              y = e.clientY;
            } else {
              x = iframeRect.left + e.clientX;
              y = iframeRect.top + e.clientY;
            }
          }

          setEditPopover({
            position: { x, y },
            highlight: stored,
          });
          setSelectionPopover(null);
        },
        "epubjs-hl",
        { fill: color },
      );

      setSelectionPopover(null);

      // Clear the selection in the iframe
      const contents = (renditionRef.current as any).getContents() as any[];
      contents.forEach((content: any) => {
        const win = content.document?.defaultView;
        if (win) win.getSelection()?.removeAllRanges();
      });

      // Auto-insert highlight reference into the notebook
      window.dispatchEvent(
        new CustomEvent("append-highlight-reference", {
          detail: {
            highlightId: highlight.id,
            cfiRange: highlight.cfiRange,
            text: highlight.text,
            note,
          },
        }),
      );
    },
    [selectionPopover, book.id],
  );

  const handleDismissPopover = useCallback(() => {
    setSelectionPopover(null);
    setEditPopover(null);
  }, []);

  const handleUpdateHighlight = useCallback(
    async (newNote: string) => {
      if (!editPopover) return;
      const { highlight } = editPopover;
      await updateHighlight(highlight.id, { note: newNote });
      // Update the ref
      highlightsRef.current.set(highlight.cfiRange, { ...highlight, note: newNote });
      setEditPopover(null);
    },
    [editPopover],
  );

  const handleDeleteHighlight = useCallback(async () => {
    if (!editPopover || !renditionRef.current) return;
    const { highlight } = editPopover;

    await deleteHighlight(highlight.id);

    // Remove annotation overlay from epub
    renditionRef.current.annotations.remove(highlight.cfiRange, "highlight");

    // Remove from ref
    highlightsRef.current.delete(highlight.cfiRange);

    setEditPopover(null);

    // Notify the annotations panel to refresh
    window.dispatchEvent(new CustomEvent("highlights-changed"));
  }, [editPopover]);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={containerRef} className="flex-1 overflow-hidden" />
        <div className="relative flex items-center justify-center border-t p-2">
          <div className="absolute left-2 flex items-center gap-1.5">
            <RadialProgress value={chapterProgress} label="Chapter" />
            <RadialProgress value={bookProgress} label="Overall" />
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
            <ReaderSettingsMenu
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
            />
          </div>
        </div>
        {selectionPopover && (
          <HighlightPopover
            position={selectionPopover.position}
            selectedText={selectionPopover.text}
            onSave={handleSaveHighlight}
            onDismiss={handleDismissPopover}
          />
        )}
        {editPopover && (
          <HighlightPopover
            mode="edit"
            position={editPopover.position}
            selectedText={editPopover.highlight.text}
            initialNote={editPopover.highlight.note}
            onUpdate={handleUpdateHighlight}
            onDelete={handleDeleteHighlight}
            onDismiss={handleDismissPopover}
          />
        )}
      </div>
      <AnnotationsPanel
        bookId={book.id}
        bookTitle={book.title}
        isOpen={annotationsPanelOpen}
        onClose={() => setAnnotationsPanelOpen(false)}
        onNavigateToCfi={navigateToCfi}
      />
    </div>
  );
}

