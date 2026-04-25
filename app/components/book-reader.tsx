import { useEffect, useRef, useCallback, useState } from "react";
import { Effect } from "effect";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, Search, TableOfContents } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import type { BookMeta } from "~/lib/stores/book-store";
import { useSettings } from "~/lib/settings";
import { ReaderSettingsMenu } from "~/components/reader-settings-menu";
import { AnnotationsPanel } from "~/components/annotations-panel";
import { HighlightPopover } from "~/components/highlight-popover";
import { useHighlights } from "~/hooks/use-highlights";
import { useReaderNavigation } from "~/lib/context/reader-context";
import type { TiptapEditorHandle } from "~/components/tiptap-editor";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";
import { cn } from "~/lib/utils";
import { SearchBar } from "~/components/search-bar";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { useReaderSearch } from "~/hooks/use-reader-search";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { appendHighlightReferenceToNotebook } from "~/lib/annotations/append-highlight-to-notebook";

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
    saveHighlight: saveHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
    highlightsRef,
  } = useHighlights({
    bookId: book.id,
    renditionRef,
    onHighlightClick: () => setAnnotationsPanelOpen(true),
    theme: settings.theme,
  });

  const handleDeleteHighlight = useCallback(
    (highlightId: string, cfiRange: string) => {
      const deleteProgram = Effect.gen(function* () {
        const svc = yield* AnnotationService;
        yield* svc.deleteHighlight(highlightId);
      });
      AppRuntime.runPromise(deleteProgram).catch(console.error);
      renditionRef.current?.annotations.remove(cfiRange, "highlight");
      highlightsRef.current.delete(cfiRange);
    },
    [highlightsRef],
  );

  const { toc, currentChapterLabel, currentPage, totalPages, navigateToCfi, navigateToTocHref } =
    useEpubLifecycle({
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
    setNavigateToHref(navigateToTocHref);
    return () => setNavigateToHref(() => {});
  }, [navigateToTocHref, setNavigateToHref]);

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
    if (!highlight) return;
    const attrs: HighlightReferenceAttrs = {
      highlightId: highlight.id,
      cfiRange: highlight.cfiRange,
      text: highlight.text,
    };

    // Panel open with editor mounted: append imperatively so the user sees
    // the highlight appear instantly; the editor's debounced save persists
    // the update to IndexedDB.
    if (editorRef.current) {
      editorRef.current.appendHighlightReference(attrs);
      setAnnotationsPanelOpen(true);
      return;
    }

    // Panel closed (editor not mounted): write the reference to the
    // notebook doc in IDB directly, then open the panel. The AnnotationsPanel
    // reloads via `useEffectQuery` when the notebook sync event fires, so it
    // will mount with the new highlight node already present — no pending
    // state needed and no risk of double-appending.
    AppRuntime.runPromise(appendHighlightReferenceToNotebook(book.id, attrs))
      .then(() => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
          );
        });
      })
      .catch((err) => console.error("Failed to append highlight to notebook:", err));
    setAnnotationsPanelOpen(true);
  }, [saveHighlightFromPopover, book.id]);

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
        <div className="flex items-center justify-between border-t px-2 min-h-14 md:min-h-10">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
            {totalPages !== null && currentPage !== null ? (
              <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-[10px] md:text-xs">
                {currentChapterLabel ? (
                  <>
                    <span className="max-w-24 truncate sm:max-w-40 md:max-w-56">
                      {currentChapterLabel}
                    </span>
                    <span className="shrink-0">·</span>
                  </>
                ) : null}
                <span className="shrink-0 tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
              </div>
            ) : null}
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
      </div>
      <AnnotationsPanel
        bookId={book.id}
        bookTitle={book.title}
        isOpen={annotationsPanelOpen}
        onClose={() => setAnnotationsPanelOpen(false)}
        onNavigateToCfi={navigateToCfi}
        onDeleteHighlight={handleDeleteHighlight}
        editorRef={editorRef}
      />
    </div>
  );
}
