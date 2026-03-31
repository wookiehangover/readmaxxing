import { useEffect, useRef, useCallback, useState } from "react";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, Search, TableOfContents } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import type { BookMeta } from "~/lib/book-store";
import { useSettings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { AnnotationsPanel } from "~/components/annotations-panel";
import { HighlightPopover } from "~/components/highlight-popover";
import { SearchBar } from "~/components/search-bar";
import { cn } from "~/lib/utils";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import { usePdfSearch } from "~/hooks/use-pdf-search";
import { usePdfHighlights } from "~/hooks/use-pdf-highlights";
import { resolveTheme } from "~/lib/settings";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";
import type { HighlightReferenceAttrs } from "~/lib/tiptap-highlight-node";

interface PdfReaderProps {
  book: BookMeta;
}

export function PdfReader({ book }: PdfReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [settings, updateSettings] = useSettings();
  const [tocOpen, setTocOpen] = useState(false);
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);
  const editorRef = useRef<TiptapEditorHandle>(null);
  const [pendingHighlight, setPendingHighlight] = useState<HighlightReferenceAttrs | null>(null);

  const {
    selectionPopover,
    saveHighlight: saveHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    reapplyAllHighlights,
    removeHighlight,
  } = usePdfHighlights({
    bookId: book.id,
    containerRef,
    theme: settings.theme,
    onHighlightClick: () => setAnnotationsPanelOpen(true),
  });

  const { toc, bookProgress, currentPage, totalPages, goToPage, goNext, goPrev, pdfDocRef } =
    usePdfLifecycle({
      bookId: book.id,
      containerRef,
      readerLayout: settings.readerLayout,
      theme: settings.theme,
      fontSize: settings.fontSize,
      onAfterRender: reapplyAllHighlights,
    });

  // Load highlights once after initial render
  const highlightsLoadedRef = useRef(false);
  useEffect(() => {
    if (totalPages > 0 && !highlightsLoadedRef.current) {
      highlightsLoadedRef.current = true;
      loadAndApplyHighlights();
    }
  }, [totalPages, loadAndApplyHighlights]);

  const {
    searchOpen,
    searchQuery,
    searchResults,
    searchIndex,
    searchNext,
    searchPrev,
    handleSearchOpen,
    handleSearchClose,
    handleSearchQueryChange,
  } = usePdfSearch({
    pdfDocRef,
    bookId: book.id,
    goToPage,
  });

  const handleUpdateSettings = useCallback(
    (update: Partial<typeof settings>) => {
      updateSettings(update);
    },
    [updateSettings],
  );

  const handleSaveHighlight = useCallback(async () => {
    const highlight = await saveHighlightFromPopover();
    if (highlight) {
      const attrs: HighlightReferenceAttrs = {
        highlightId: highlight.id,
        cfiRange: highlight.cfiRange,
        text: highlight.text,
      };

      if (editorRef.current) {
        editorRef.current.appendHighlightReference(attrs);
      } else {
        setPendingHighlight(attrs);
      }
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

  const handleDeleteHighlight = useCallback(
    (_highlightId: string, cfiRange: string) => {
      removeHighlight(cfiRange);
    },
    [removeHighlight],
  );

  const handleNavigateToHighlight = useCallback(
    (cfi: string) => {
      // Parse synthetic PDF cfiRange to navigate to the page
      const match = cfi.match(/^pdf:page:(\d+)/);
      if (match) {
        goToPage(parseInt(match[1], 10));
      }
    },
    [goToPage],
  );

  const isScrollMode = settings.readerLayout === "scroll";
  const isDark = resolveTheme(settings.theme) === "dark";

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
            className={cn("h-full overflow-auto px-4 pt-4 pb-2 md:px-8 md:pt-6 md:pb-4", {
              "invert hue-rotate-180": isDark,
            })}
            data-testid="pdf-container"
          />
          {!isScrollMode && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              <button
                type="button"
                aria-label="Previous page"
                className="pointer-events-auto absolute top-0 left-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={goPrev}
              />
              <button
                type="button"
                aria-label="Next page"
                className="pointer-events-auto absolute top-0 right-0 h-full w-1/4 cursor-default appearance-none border-none bg-transparent p-0 active:bg-black/5 md:w-12 md:cursor-pointer dark:active:bg-white/5"
                onPointerUp={goNext}
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t px-2 min-h-14 md:min-h-10 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center gap-1.5">
            {totalPages > 0 ? (
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
                  onClick={goPrev}
                  data-testid="pdf-prev"
                >
                  <ChevronLeft className="size-5 md:size-4" />
                  <span className="sr-only">Previous page</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden size-10 md:flex md:size-8"
                  onClick={goNext}
                  data-testid="pdf-next"
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
              onClick={() => (searchOpen ? handleSearchClose() : handleSearchOpen())}
              title="Search in book (Cmd+F)"
              data-testid="pdf-search-btn"
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
                        // PDF TOC href is JSON.stringify(dest) — try to extract page number
                        try {
                          const dest = JSON.parse(href);
                          if (typeof dest === "number") {
                            goToPage(dest + 1);
                          }
                        } catch {
                          // ignore
                        }
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
      </div>
      <AnnotationsPanel
        bookId={book.id}
        bookTitle={book.title}
        isOpen={annotationsPanelOpen}
        onClose={() => setAnnotationsPanelOpen(false)}
        onNavigateToCfi={handleNavigateToHighlight}
        onDeleteHighlight={handleDeleteHighlight}
        editorRef={editorRef}
      />
    </div>
  );
}
