import { useEffect, useRef, useCallback, useState } from "react";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, Search, TableOfContents } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import type { BookMeta } from "~/lib/book-store";
import { useSettings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { AnnotationsPanel } from "~/components/annotations-panel";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/lib/use-highlights";
import { useReaderNavigation } from "~/lib/reader-context";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";
import { cn } from "~/lib/utils";
import { SearchBar } from "~/components/search-bar";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { useReaderSearch } from "~/hooks/use-reader-search";

interface BookReaderProps {
  book: BookMeta;
}

export function BookReader({ book }: BookReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<import("epubjs/types/book").default | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [settings, updateSettings] = useSettings();
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [pendingHighlight, setPendingHighlight] = useState<HighlightReferenceAttrs | null>(null);
  const { toc: contextToc, navigateToHref, setToc, setNavigateToHref } = useReaderNavigation();
  const [tocOpen, setTocOpen] = useState(false);

  const {
    searchOpen,
    searchQuery,
    searchResults,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchClose,
    handleSearchQueryChange,
    handleSearchOpenFromIframe,
  } = useReaderSearch({
    bookRef,
    renditionRef,
    bookId: book.id,
  });

  const {
    selectionPopover,
    editPopover,
    saveHighlight: saveHighlightFromPopover,
    deleteHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
  } = useHighlights({ bookId: book.id, renditionRef, containerRef });

  const { toc, bookProgress, currentPage, totalPages, navigateToCfi } = useEpubLifecycle({
    bookId: book.id,
    containerRef,
    readerLayout: settings.readerLayout,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    theme: settings.theme,
    loadAndApplyHighlights,
    registerSelectionHandler,
    onTocExtracted: (tocData) => {
      setToc(tocData);
      setNavigateToHref((href: string) => {
        renditionRef.current?.display(href).catch((err: unknown) => {
          console.warn("TOC navigation failed:", err);
        });
      });
    },
    onCleanupToc: () => {
      setToc([]);
      setNavigateToHref(() => {});
    },
    onSearchOpen: handleSearchOpenFromIframe,
    bookRef,
    renditionRef,
  });

  // Use contextToc from the navigation context (synced via onTocExtracted)
  const activeToc = contextToc.length > 0 ? contextToc : toc;

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
            className={cn("h-full overflow-hidden", {
              "px-4 pt-6 pb-2 md:px-8 md:pt-10 md:pb-4": settings.readerLayout,
            })}
          />
          {!isScrollMode && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              {/* Previous page zone: narrow margin on desktop, 25% on mobile */}
              <button
                type="button"
                aria-label="Previous page"
                className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={handlePrev}
              />
              {/* Next page zone: narrow margin on desktop, 25% on mobile */}
              <button
                type="button"
                aria-label="Next page"
                className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={handleNext}
              />
            </div>
          )}
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
              onClick={() => (searchOpen ? handleSearchClose() : handleSearchOpenFromIframe())}
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
            {activeToc.length > 0 && (
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
                      entries={activeToc}
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
