import type { DockviewPanelApi } from "dockview-react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Notebook,
  Search,
  TableOfContents,
} from "lucide-react";
import { TocList } from "~/components/book-list";
import {
  ReaderActionsMenu,
  ReaderFormattingMenu,
  ReaderSettingsMenu,
} from "~/components/reader-settings-menu";
import { SearchBar } from "~/components/search-bar";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
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
          "px-16 pt-6 pb-2 md:pt-10 md:pb-4": readerLayout,
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
            className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
            onPointerUp={(event) => {
              onPrevious();
              blurPageTurnControl(event);
            }}
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
            onPointerUp={(event) => {
              onNext();
              blurPageTurnControl(event);
            }}
          />
        </div>
      )}
    </div>
  );
}

interface EpubReaderToolbarProps {
  panelApi?: DockviewPanelApi;
  zenMode: boolean;
  toolbarVisible: boolean;
  showToolbarPersistent: () => void;
  resetToolbarTimer: () => void;
  currentChapterLabel: string | null;
  currentPage: number | null;
  totalPages: number | null;
  isScrollMode: boolean;
  isMobile: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSearchOpen: () => void;
  onOpenNotebook: () => void;
  onOpenChat: () => void;
  toc: TocEntry[];
  tocOpen: boolean;
  setTocOpen: React.Dispatch<React.SetStateAction<boolean>>;
  navigateToTocHref: (href: string) => void;
  localSettings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  book: BookMeta;
  onDownload: () => void;
  onCopyPageAsMarkdown: () => void;
  onOpenSpeedread: () => void;
  onBookmarkPage: () => void | Promise<void>;
  isBookmarked: boolean;
}

export function EpubReaderToolbar({
  panelApi,
  zenMode,
  toolbarVisible,
  showToolbarPersistent,
  resetToolbarTimer,
  currentChapterLabel,
  currentPage,
  totalPages,
  isScrollMode,
  isMobile,
  onPrevious,
  onNext,
  onSearchOpen,
  onOpenNotebook,
  onOpenChat,
  toc,
  tocOpen,
  setTocOpen,
  navigateToTocHref,
  localSettings,
  onUpdateSettings,
  book,
  onDownload,
  onCopyPageAsMarkdown,
  onOpenSpeedread,
  onBookmarkPage,
  isBookmarked,
}: EpubReaderToolbarProps) {
  if (!panelApi) {
    return (
      <ReadingRailMenuPortal>
        <ReaderSettingsMenu
          settings={localSettings}
          onUpdateSettings={onUpdateSettings}
          book={book}
          onDownload={onDownload}
          onCopyPageAsMarkdown={onCopyPageAsMarkdown}
          onOpenSpeedread={onOpenSpeedread}
          onBookmarkPage={onBookmarkPage}
          isBookmarked={isBookmarked}
          toc={toc}
          onNavigateToToc={navigateToTocHref}
        />
      </ReadingRailMenuPortal>
    );
  }

  return (
    <div
      className={cn({ "absolute right-0 bottom-0 left-0 z-20 pt-10": zenMode })}
      onMouseEnter={zenMode ? showToolbarPersistent : undefined}
      onMouseLeave={zenMode ? resetToolbarTimer : undefined}
    >
      <div
        className={cn(
          "relative flex h-10 items-center justify-center px-2 transition-all duration-300 ease-in-out",
          {
            "max-h-0 overflow-hidden border-t-0 opacity-0":
              (isMobile || zenMode) && !toolbarVisible,
            "max-h-20 opacity-100": (!isMobile && !zenMode) || toolbarVisible,
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
                {currentPage} / {totalPages}
              </span>
            </div>
          ) : null}
        </div>
        {!isScrollMode && (
          <div className="hidden items-center gap-4 md:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={onPrevious}
              onPointerUp={blurPageTurnControl}
            >
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button variant="ghost" size="icon" onClick={onNext} onPointerUp={blurPageTurnControl}>
              <ChevronRight className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        )}
        <div className="absolute right-2 flex items-center gap-1">
          {isMobile && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSearchOpen}
                title="Search in book (Cmd+F)"
              >
                <Search className="size-4" />
                <span className="sr-only">Search in book</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={onOpenNotebook} title="Open Notebook">
                <Notebook className="size-4" />
                <span className="sr-only">Open Notebook</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={onOpenChat} title="Chat about book">
                <MessageSquare className="size-4" />
                <span className="sr-only">Chat about book</span>
              </Button>
            </>
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
                      navigateToTocHref(href);
                      setTocOpen(false);
                    }}
                  />
                </ul>
              </PopoverContent>
            </Popover>
          )}
          <ReaderFormattingMenu settings={localSettings} onUpdateSettings={onUpdateSettings} />
          <ReaderActionsMenu
            book={book}
            onDownload={onDownload}
            onCopyPageAsMarkdown={onCopyPageAsMarkdown}
            onOpenSpeedread={onOpenSpeedread}
            onBookmarkPage={onBookmarkPage}
            isBookmarked={isBookmarked}
          />
        </div>
      </div>
    </div>
  );
}
