import { useEffect, useRef, useState } from "react";
import { DEFAULT_MIN_SPREAD_WIDTH } from "@readmaxxing/epub-successor";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { SearchBar } from "~/components/search-bar";
import type { TocEntry } from "~/lib/context/reader-context";
import type { BookMeta } from "~/lib/stores/book-store";
import type { ReaderLayout, Settings } from "~/lib/settings";
import { cn } from "~/lib/utils";
import { ReadingRailMenuPortal } from "~/components/reading-shell/reading-rail-menu-portal";

function blurPageTurnControl(event: React.PointerEvent<HTMLButtonElement>) {
  event.currentTarget.blur();
}

function getInlinePadding(element: HTMLElement) {
  const style = getComputedStyle(element);
  const start = Number.parseFloat(style.paddingInlineStart);
  const end = Number.parseFloat(style.paddingInlineEnd);
  return (Number.isFinite(start) ? start : 0) + (Number.isFinite(end) ? end : 0);
}

function useReaderPaneSupportsSpread(readerHostRef: React.RefObject<HTMLDivElement | null>) {
  const readerPaneRef = useRef<HTMLDivElement>(null);
  const [supportsSpread, setSupportsSpread] = useState(false);

  useEffect(() => {
    const readerPane = readerPaneRef.current;
    if (!readerPane || typeof ResizeObserver === "undefined") return;

    const update = (width: number) => {
      const effectiveWidth =
        width - (readerHostRef.current ? getInlinePadding(readerHostRef.current) : 0);
      setSupportsSpread(effectiveWidth >= DEFAULT_MIN_SPREAD_WIDTH);
    };
    update(readerPane.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      update(entries[0]?.contentRect.width ?? readerPane.getBoundingClientRect().width);
    });
    observer.observe(readerPane);
    return () => observer.disconnect();
  }, [readerHostRef]);

  return { readerPaneRef, supportsSpread };
}

interface EpubReaderSurfaceProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  searchOpen: boolean;
  searchQuery: string;
  searchResultsLength: number;
  searchIndex: number;
  searchNext: () => void;
  searchPrev: () => void;
  onSearchClose: () => void;
  onSearchQueryChange: (query: string) => void;
  loadError: boolean;
  readerLayout: ReaderLayout;
  isScrollMode: boolean;
  isMobile: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export function EpubReaderSurface({
  containerRef,
  searchOpen,
  searchQuery,
  searchResultsLength,
  searchIndex,
  searchNext,
  searchPrev,
  onSearchClose,
  onSearchQueryChange,
  loadError,
  readerLayout,
  isScrollMode,
  isMobile,
  onPrevious,
  onNext,
}: EpubReaderSurfaceProps) {
  const { readerPaneRef, supportsSpread } = useReaderPaneSupportsSpread(containerRef);

  return (
    <div ref={readerPaneRef} className="relative flex-1 overflow-hidden">
      {searchOpen && (
        <div className="absolute top-0 right-0 left-0 z-10">
          <SearchBar
            query={searchQuery}
            onQueryChange={onSearchQueryChange}
            resultCount={searchResultsLength}
            currentIndex={searchIndex}
            onNext={searchNext}
            onPrev={searchPrev}
            onClose={onSearchClose}
          />
        </div>
      )}
      <div
        ref={containerRef}
        className={cn("h-full overflow-hidden", {
          "pt-6 pb-2 md:pt-10 md:pb-4": readerLayout,
          "px-10 md:px-16": readerLayout && (!isMobile || isScrollMode),
          "mx-auto": readerLayout === "single" || readerLayout === "spread",
          "max-w-[72ch]":
            readerLayout === "single" || (readerLayout === "spread" && !supportsSpread),
          "max-w-[calc(144ch+64px)]": readerLayout === "spread" && supportsSpread,
        })}
      />
      {loadError && (
        <div
          className="bg-background absolute inset-0 z-20 flex items-center justify-center p-6 text-center"
          role="alert"
        >
          <p className="text-muted-foreground">
            Unable to load this book. Check your connection and try again.
          </p>
        </div>
      )}
      {!isScrollMode && !isMobile && (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <button
            type="button"
            aria-label="Previous page"
            className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5 hover:bg-muted/20 text-muted hover:text-accent transition-colors"
            onClick={onPrevious}
            onPointerUp={blurPageTurnControl}
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next page"
            className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5 hover:bg-muted/20 text-muted hover:text-accent transition-colors"
            onClick={onNext}
            onPointerUp={blurPageTurnControl}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

interface EpubReaderToolbarProps {
  toc: TocEntry[];
  navigateToTocHref: (href: string) => void;
  localSettings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  book: BookMeta;
  readOnly?: boolean;
  onSyncToFurthestPage?: () => void | Promise<void>;
  onDownload?: () => void;
  onCopyPageAsMarkdown?: () => void;
  onOpenSpeedread?: () => void;
  onBookmarkPage?: () => void | Promise<void>;
  isBookmarked?: boolean;
  bookmarksLoaded?: boolean;
}

export function EpubReaderToolbar({
  toc,
  navigateToTocHref,
  localSettings,
  onUpdateSettings,
  book,
  readOnly = false,
  onSyncToFurthestPage,
  onDownload,
  onCopyPageAsMarkdown,
  onOpenSpeedread,
  onBookmarkPage,
  isBookmarked,
  bookmarksLoaded = true,
}: EpubReaderToolbarProps) {
  return (
    <ReadingRailMenuPortal>
      <ReaderSettingsMenu
        settings={localSettings}
        onUpdateSettings={onUpdateSettings}
        book={readOnly ? undefined : book}
        onSyncToFurthestPage={onSyncToFurthestPage}
        onDownload={onDownload}
        onCopyPageAsMarkdown={onCopyPageAsMarkdown}
        onOpenSpeedread={onOpenSpeedread}
        onBookmarkPage={onBookmarkPage}
        isBookmarked={isBookmarked}
        bookmarksLoaded={bookmarksLoaded}
        toc={toc}
        onNavigateToToc={navigateToTocHref}
      />
    </ReadingRailMenuPortal>
  );
}
