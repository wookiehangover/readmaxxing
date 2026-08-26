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
  toggleToolbar: () => void;
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
  toggleToolbar,
  onPrevious,
  onNext,
}: EpubReaderSurfaceProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
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
          "px-10 pt-6 pb-2 md:px-16 md:pt-10 md:pb-4": readerLayout,
          "mx-auto max-w-[72ch]": readerLayout === "single",
          "mx-auto max-w-[calc(144ch+64px)]": readerLayout === "spread",
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
      {!isScrollMode && (
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
