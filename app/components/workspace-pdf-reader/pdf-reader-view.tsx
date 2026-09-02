import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Notebook,
  Search,
  TableOfContents,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { TocList } from "~/components/book-list";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { SearchBar } from "~/components/search-bar";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import type { TocEntry } from "~/lib/context/reader-context";
import type { Settings } from "~/lib/settings";
import type { BookMeta } from "~/lib/stores/book-store";
import { cn } from "~/lib/utils";
import { ReadingRailMenuPortal } from "~/components/reading-shell/reading-rail-menu-portal";
import { addPdfPageCarousel } from "~/hooks/pdf-page-carousel";

function blurPageTurnControl(event: React.PointerEvent<HTMLButtonElement>) {
  event.currentTarget.blur();
}

function hasSelectedText(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

interface PdfReaderViewProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewerRef: React.RefObject<any>;
  preparePageForCarousel: (page: number) => Promise<boolean>;
  localSettings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  book: BookMeta;
  readOnly?: boolean;
  onSyncToFurthestPage?: () => void | Promise<void>;
  onDownload?: () => void;
  onBookmarkPage?: () => void | Promise<void>;
  isBookmarked?: boolean;
  bookmarksLoaded?: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
  searchIndex: number;
  searchNext: () => void;
  searchPrev: () => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onSearchQueryChange: (query: string) => void;
  isScrollMode: boolean;
  isMobile: boolean;
  enablePageSwiping: boolean;
  toggleToolbar: () => void;
  goPrev: () => void;
  goNext: () => void;
  toolbarVisible: boolean;
  totalPages: number;
  currentPage: number;
  bookProgress: number;
  onOpenNotebook?: () => void;
  onOpenChat?: () => void;
  toc: TocEntry[];
  tocOpen: boolean;
  setTocOpen: React.Dispatch<React.SetStateAction<boolean>>;
  goToPage: (page: number) => void;
}

export function PdfReaderView({
  containerRef,
  viewerRef,
  preparePageForCarousel,
  localSettings,
  onUpdateSettings,
  book,
  readOnly = false,
  onSyncToFurthestPage,
  onDownload,
  onBookmarkPage,
  isBookmarked,
  bookmarksLoaded = true,
  searchOpen,
  searchQuery,
  searchResultCount,
  searchIndex,
  searchNext,
  searchPrev,
  onSearchOpen,
  onSearchClose,
  onSearchQueryChange,
  isScrollMode,
  isMobile,
  enablePageSwiping,
  toggleToolbar,
  goPrev,
  goNext,
  toolbarVisible,
  totalPages,
  currentPage,
  bookProgress,
  onOpenNotebook,
  onOpenChat,
  toc,
  tocOpen,
  setTocOpen,
  goToPage,
}: PdfReaderViewProps) {
  const lastSwipeAtRef = useRef(0);
  const currentPageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  currentPageRef.current = currentPage;
  totalPagesRef.current = totalPages;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enablePageSwiping || isScrollMode) return;

    const removePageCarousel = addPdfPageCarousel({
      container,
      getViewer: () => viewerRef.current,
      getCurrentPage: () => currentPageRef.current,
      getTotalPages: () => totalPagesRef.current,
      preparePage: preparePageForCarousel,
      onNavigate: goToPage,
      onGestureStart: () => {
        lastSwipeAtRef.current = Date.now();
      },
      getSelection: () => window.getSelection(),
    });
    const handleTap = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.defaultPrevented ||
        Date.now() - lastSwipeAtRef.current < 700 ||
        hasSelectedText()
      ) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest("a, button, input, select, textarea")) return;

      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < rect.width / 4) goPrev();
      else if (x > (rect.width * 3) / 4) goNext();
      else toggleToolbar();
    };

    container.addEventListener("click", handleTap);
    return () => {
      removePageCarousel();
      container.removeEventListener("click", handleTap);
    };
  }, [
    containerRef,
    goNext,
    goPrev,
    goToPage,
    enablePageSwiping,
    isScrollMode,
    preparePageForCarousel,
    toggleToolbar,
    viewerRef,
  ]);

  return (
    <>
      <ReadingRailMenuPortal>
        <ReaderSettingsMenu
          settings={localSettings}
          onUpdateSettings={onUpdateSettings}
          isPdf
          book={readOnly ? undefined : book}
          onSyncToFurthestPage={onSyncToFurthestPage}
          onDownload={onDownload}
          onBookmarkPage={onBookmarkPage}
          isBookmarked={isBookmarked}
          bookmarksLoaded={bookmarksLoaded}
          toc={toc}
          onNavigateToToc={(href) => {
            try {
              const destination = JSON.parse(href);
              if (typeof destination === "number") goToPage(destination + 1);
            } catch {
              // Ignore malformed PDF destinations.
            }
          }}
        />
      </ReadingRailMenuPortal>
      <div className="relative flex-1 overflow-hidden">
        {searchOpen && (
          <div className="absolute top-0 right-0 left-0 z-10">
            <SearchBar
              query={searchQuery}
              onQueryChange={onSearchQueryChange}
              resultCount={searchResultCount}
              currentIndex={searchIndex}
              onNext={searchNext}
              onPrev={searchPrev}
              onClose={onSearchClose}
            />
          </div>
        )}
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto"
          data-testid="pdf-container"
        />
        {!isScrollMode && !isMobile && (
          <div className="pointer-events-none absolute inset-0 z-[5]">
            <button
              type="button"
              aria-label="Previous page"
              className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
              onClick={goPrev}
              onPointerUp={blurPageTurnControl}
            />
            <button
              type="button"
              aria-label="Next page"
              className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
              onClick={goNext}
              onPointerUp={blurPageTurnControl}
            />
          </div>
        )}
      </div>
      <div
        className={cn(
          "relative flex h-10 items-center justify-center px-2 transition-all duration-300 ease-in-out",
          {
            "max-h-0 overflow-hidden border-t-0 opacity-0": isMobile && !toolbarVisible,
            "max-h-20 opacity-100": !isMobile || toolbarVisible,
          },
        )}
      >
        <div className="absolute left-2 flex items-center gap-1.5">
          {totalPages > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {currentPage} / {totalPages}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs tabular-nums">
              {Math.round(bookProgress)}%
            </span>
          )}
        </div>
        {!isScrollMode && (
          <div className="hidden items-center gap-4 md:flex">
            <Button
              variant="ghost"
              size="icon"
              onClick={goPrev}
              onPointerUp={blurPageTurnControl}
              data-testid="pdf-prev"
            >
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={goNext}
              onPointerUp={blurPageTurnControl}
              data-testid="pdf-next"
            >
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
                onClick={() => (searchOpen ? onSearchClose() : onSearchOpen())}
                title="Search in book (Cmd+F)"
                data-testid="pdf-search-btn"
              >
                <Search className="size-4" />
                <span className="sr-only">Search in book</span>
              </Button>
              {onOpenNotebook ? (
                <Button variant="ghost" size="icon" onClick={onOpenNotebook} title="Open Notebook">
                  <Notebook className="size-4" />
                  <span className="sr-only">Open Notebook</span>
                </Button>
              ) : null}
              {onOpenChat ? (
                <Button variant="ghost" size="icon" onClick={onOpenChat} title="Open Chat">
                  <MessageCircle className="size-4" />
                  <span className="sr-only">Open Chat</span>
                </Button>
              ) : null}
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
                      try {
                        const destination = JSON.parse(href);
                        if (typeof destination === "number") goToPage(destination + 1);
                      } catch {
                        // Ignore malformed PDF destinations.
                      }
                      setTocOpen(false);
                    }}
                  />
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </>
  );
}
