import { useEffect, useRef, useCallback, useState } from "react";
import { Effect } from "effect";
import type Rendition from "epubjs/types/rendition";
import { Button } from "~/components/ui/button";
import { ChevronLeft, ChevronRight, Notebook, Search, TableOfContents } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "~/components/ui/popover";
import { TocList } from "~/components/book-list";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useSettings, type ReaderLayout, type Settings, type TextAlign } from "~/lib/settings";
import { ReaderActionsMenu, ReaderFormattingMenu } from "~/components/reader-settings-menu";
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
import { BookmarkService, type Bookmark as BookmarkRecord } from "~/lib/stores/bookmark-store";
import {
  getBookPreferences,
  saveBookPreferences,
  type BookPreferences,
} from "~/lib/stores/book-preferences-store";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { useSyncListener } from "~/hooks/use-sync-listener";

interface BookReaderProps {
  book: BookMeta;
}

export function BookReader({ book }: BookReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<import("epubjs/types/book").default | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [settings, updateSettings] = useSettings();
  const [localFontFamily, setLocalFontFamily] = useState<string>(() => settings.fontFamily);
  const [localFontSize, setLocalFontSize] = useState<number>(() => settings.fontSize);
  const [localLineHeight, setLocalLineHeight] = useState<number>(() => settings.lineHeight);
  const [localTextAlign, setLocalTextAlign] = useState<TextAlign>(() => settings.textAlign);
  const [localReaderLayout, setLocalReaderLayout] = useState<ReaderLayout>(
    () => settings.readerLayout,
  );
  const [annotationsPanelOpen, setAnnotationsPanelOpen] = useState(false);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
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

  const {
    toc,
    currentChapterLabel,
    currentPage,
    totalPages,
    navigateToCfi,
    navigateToTocHref,
    latestCfiRef,
  } = useEpubLifecycle({
    bookId: book.id,
    containerRef,
    readerLayout: localReaderLayout,
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
    textAlign: localTextAlign,
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

  const bookmarkSyncVersion = useSyncListener(["bookmark"]);
  const { data: bookmarks } = useEffectQuery(
    () =>
      BookmarkService.pipe(
        Effect.andThen((s) => s.getBookmarksByBook(book.id)),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to load bookmarks:", error);
            return [] as BookmarkRecord[];
          }),
        ),
      ),
    [book.id, bookmarkVersion, bookmarkSyncVersion],
  );

  // Use contextToc from the navigation context (synced via onTocExtracted)
  const activeToc = contextToc.length > 0 ? contextToc : toc;

  useEffect(() => {
    let cancelled = false;

    getBookPreferences(book.id)
      .then((prefs) => {
        if (cancelled) return;
        setLocalFontFamily(prefs?.fontFamily ?? settings.fontFamily);
        setLocalFontSize(prefs?.fontSize ?? settings.fontSize);
        setLocalLineHeight(prefs?.lineHeight ?? settings.lineHeight);
        setLocalTextAlign(prefs && "textAlign" in prefs ? prefs.textAlign : settings.textAlign);
        setLocalReaderLayout(prefs?.readerLayout ?? settings.readerLayout);
      })
      .catch((error) => console.error("Failed to load book preferences:", error));

    return () => {
      cancelled = true;
    };
  }, [
    book.id,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.textAlign,
    settings.readerLayout,
  ]);

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
    (update: Partial<Settings>) => {
      if (update.theme !== undefined) updateSettings({ theme: update.theme });

      const hasBookPreferenceUpdate =
        update.fontFamily !== undefined ||
        update.fontSize !== undefined ||
        update.lineHeight !== undefined ||
        "textAlign" in update ||
        update.readerLayout !== undefined;

      if (!hasBookPreferenceUpdate) return;

      if (update.fontFamily !== undefined) setLocalFontFamily(update.fontFamily);
      if (update.fontSize !== undefined) setLocalFontSize(update.fontSize);
      if (update.lineHeight !== undefined) setLocalLineHeight(update.lineHeight);
      if ("textAlign" in update) setLocalTextAlign(update.textAlign);
      if (update.readerLayout !== undefined && update.readerLayout !== localReaderLayout) {
        const cfi = renditionRef.current?.location?.start?.cfi;
        setLocalReaderLayout(update.readerLayout);
        if (cfi) queueMicrotask(() => renditionRef.current?.display(cfi));
      }

      const updatedPrefs: BookPreferences = {
        fontFamily: update.fontFamily ?? localFontFamily,
        fontSize: update.fontSize ?? localFontSize,
        lineHeight: update.lineHeight ?? localLineHeight,
        textAlign: "textAlign" in update ? update.textAlign : localTextAlign,
        readerLayout: update.readerLayout ?? localReaderLayout,
      };

      saveBookPreferences(book.id, updatedPrefs).catch((error) =>
        console.error("Failed to save book preferences:", error),
      );
    },
    [
      book.id,
      localFontFamily,
      localFontSize,
      localLineHeight,
      localTextAlign,
      localReaderLayout,
      updateSettings,
    ],
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

  const handleCopyAsMarkdown = useCallback(async () => {
    if (!selectionPopover) return;
    await navigator.clipboard.writeText(selectionPopover.text);
    dismissPopovers();

    const contents = (renditionRef.current as any)?.getContents() as any[] | undefined;
    contents?.forEach((content: any) => {
      const win = content.document?.defaultView;
      if (win) win.getSelection()?.removeAllRanges();
    });
  }, [selectionPopover, dismissPopovers]);

  const handleCopyPageAsMarkdown = useCallback(async () => {
    const contents = (renditionRef.current as any)?.getContents?.() as any[] | undefined;
    if (contents?.length) {
      const text = contents
        .map((content) => {
          const doc = content.document as Document;
          return doc.body?.innerText || doc.body?.textContent || "";
        })
        .join("\n\n");
      await navigator.clipboard.writeText(text);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      const data = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getBookData(book.id))),
      );
      if (!data) return;
      const blob = new Blob([data], {
        type: book.format === "pdf" ? "application/pdf" : "application/epub+zip",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = book.title + (book.format === "pdf" ? ".pdf" : ".epub");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download book:", error);
    }
  }, [book.id, book.title, book.format]);

  const getCurrentCfi = useCallback(() => {
    const latestCfi = latestCfiRef.current;
    if (latestCfi) return latestCfi;
    const rendition = renditionRef.current as any;
    let location = rendition?.location;
    if (!location) {
      try {
        location = rendition?.currentLocation?.();
      } catch {
        // epubjs may call into an uninitialized internal manager.
      }
    }
    return (location?.start?.cfi as string | undefined) ?? null;
  }, [latestCfiRef]);

  const currentCfi = getCurrentCfi();
  const currentBookmark = bookmarks?.find((bookmark) => bookmark.cfi === currentCfi);

  const handleBookmarkPage = useCallback(async () => {
    const cfi = getCurrentCfi();
    if (!cfi) return;
    const existingBookmark = bookmarks?.find((bookmark) => bookmark.cfi === cfi);
    const now = Date.now();

    await AppRuntime.runPromise(
      BookmarkService.pipe(
        Effect.andThen((s) =>
          existingBookmark
            ? s.deleteBookmark(existingBookmark.id)
            : s.saveBookmark({
                id: `bookmark:${book.id}:cfi:${encodeURIComponent(cfi)}`,
                bookId: book.id,
                cfi,
                label: currentChapterLabel ?? undefined,
                displayPage: currentPage ?? undefined,
                createdAt: now,
                updatedAt: now,
              }),
        ),
      ),
    );
    setBookmarkVersion((version) => version + 1);
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("sync:entity-updated", { detail: { entity: "bookmark" } }),
      );
    });
  }, [book.id, bookmarks, currentChapterLabel, currentPage, getCurrentCfi]);

  const isScrollMode = localReaderLayout === "scroll";

  const localSettings: Settings = {
    ...settings,
    fontFamily: localFontFamily,
    fontSize: localFontSize,
    lineHeight: localLineHeight,
    textAlign: localTextAlign,
    readerLayout: localReaderLayout,
  };

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
              "px-4 pt-6 pb-2 md:px-8 md:pt-10 md:pb-4": localReaderLayout,
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
                  {currentPage} / {totalPages}
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
            <ReaderFormattingMenu
              settings={localSettings}
              onUpdateSettings={handleUpdateSettings}
            />
            <ReaderActionsMenu
              onCopyPageAsMarkdown={handleCopyPageAsMarkdown}
              onDownload={handleDownload}
              onBookmarkPage={handleBookmarkPage}
              isBookmarked={Boolean(currentBookmark)}
            />
          </div>
        </div>
        {selectionPopover && (
          <HighlightPopover
            position={selectionPopover.position}
            onCopyAsMarkdown={handleCopyAsMarkdown}
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
