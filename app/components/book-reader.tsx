import { useEffect, useRef, useCallback } from "react";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Book } from "~/lib/book-store";
import { useSettings, resolveTheme } from "~/lib/settings";
import type { ReaderLayout } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";

interface BookReaderProps {
  book: Book;
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

    // Register light and dark themes for epub iframe content
    rendition.themes.register("light", {
      body: { color: "#1a1a1a !important", background: "#ffffff !important" },
      a: { color: "inherit !important" },
    });
    rendition.themes.register("dark", {
      body: { color: "#e0e0e0 !important", background: "#1a1a1a !important" },
      a: { color: "inherit !important" },
    });

    // Select the appropriate theme
    const effectiveTheme = resolveTheme(settings.theme);
    rendition.themes.select(effectiveTheme);

    // Apply typography overrides
    rendition.themes.override("font-family", `"${settings.fontFamily}", serif`);
    rendition.themes.override("font-size", `${settings.fontSize}%`);
    rendition.themes.override("line-height", `${settings.lineHeight}`);

    rendition.display();

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

  // React to typography changes without recreating the rendition
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    rendition.themes.override("font-family", `"${settings.fontFamily}", serif`);
    rendition.themes.override("font-size", `${settings.fontSize}%`);
    rendition.themes.override("line-height", `${settings.lineHeight}`);
  }, [settings.fontFamily, settings.fontSize, settings.lineHeight]);

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

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="flex-1 overflow-hidden" />
      <div className="flex items-center justify-center gap-4 border-t p-2">
        {!isScrollMode && (
          <>
            <Button variant="ghost" size="icon" onClick={handlePrev}>
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={handleNext}>
              <ChevronRight className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </>
        )}
        <ReaderSettingsMenu
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
        />
      </div>
    </div>
  );
}

