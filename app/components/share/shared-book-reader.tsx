import { useCallback, useRef, useState } from "react";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import {
  EpubReaderSurface,
  EpubReaderToolbar,
} from "~/components/workspace-book-reader/epub-reader-chrome";
import { PdfReaderView } from "~/components/workspace-pdf-reader/pdf-reader-view";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { useIsMobile } from "~/hooks/use-mobile";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import { useToolbarAutoHide } from "~/hooks/use-toolbar-auto-hide";
import {
  useResolvedTheme,
  useSettings,
  type PdfLayout,
  type ReaderLayout,
  type Settings,
} from "~/lib/settings";
import type { BookFormat, BookMeta } from "~/lib/stores/book-store";

interface SharedBookReaderProps {
  shareId: string;
  fileUrl: string;
  format: BookFormat;
  currentCfi: string | null;
}

async function loadSharedFile(fileUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Unable to load shared file (${response.status})`);
  return response.arrayBuffer();
}

function SharedEpubReader({
  book,
  loadData,
  currentCfi,
}: {
  book: BookMeta;
  loadData: () => Promise<ArrayBuffer>;
  currentCfi: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<SuccessorRenditionAdapter | null>(null);
  const isMobile = useIsMobile();
  const [settings, updateSettings] = useSettings();
  const resolvedTheme = useResolvedTheme(settings.theme);
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>("spread");
  const localSettings = { ...settings, readerLayout };
  const { showToolbar, toggleToolbar } = useToolbarAutoHide(
    Boolean(isMobile),
    settings.zenMode ?? false,
  );
  const onUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      if (update.readerLayout) setReaderLayout(update.readerLayout);
      updateSettings(update);
    },
    [updateSettings],
  );
  const { toc, loadError, navigateToTocHref, navigationInProgressRef, markNavigationInProgress } =
    useEpubLifecycle({
      bookId: book.id,
      containerRef,
      loadData,
      initialPosition: currentCfi,
      persistPosition: false,
      readerLayout,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      fontWeight: settings.fontWeight,
      lineHeight: settings.lineHeight,
      textAlign: settings.textAlign,
      theme: resolvedTheme,
      loadAndApplyHighlights: async () => {},
      registerSelectionHandler: () => {},
      renditionRef,
      onRelocated: showToolbar,
      isMobile: Boolean(isMobile),
      onToggleToolbar: toggleToolbar,
    });
  const go = useCallback(
    (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      markNavigationInProgress();
      void rendition[direction]().catch(() => {
        navigationInProgressRef.current = false;
      });
    },
    [markNavigationInProgress, navigationInProgressRef],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="shared-epub-reader">
      <EpubReaderSurface
        containerRef={containerRef}
        searchOpen={false}
        searchQuery=""
        searchResultsLength={0}
        searchIndex={0}
        searchNext={() => {}}
        searchPrev={() => {}}
        onSearchClose={() => {}}
        onSearchQueryChange={() => {}}
        loadError={loadError}
        readerLayout={readerLayout}
        isScrollMode={readerLayout === "scroll"}
        isMobile={Boolean(isMobile)}
        onPrevious={() => go("prev")}
        onNext={() => go("next")}
      />
      <EpubReaderToolbar
        book={book}
        readOnly
        toc={toc}
        navigateToTocHref={navigateToTocHref}
        localSettings={localSettings}
        onUpdateSettings={onUpdateSettings}
      />
    </div>
  );
}

function SharedPdfReader({
  book,
  loadData,
  currentCfi,
}: {
  book: BookMeta;
  loadData: () => Promise<ArrayBuffer>;
  currentCfi: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [settings, updateSettings] = useSettings();
  const resolvedTheme = useResolvedTheme(settings.theme);
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>(settings.pdfLayout);
  const localSettings = { ...settings, pdfLayout };
  const [tocOpen, setTocOpen] = useState(false);
  const { toolbarVisible, showToolbar, toggleToolbar } = useToolbarAutoHide(Boolean(isMobile));
  const onUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      if (update.pdfLayout) setPdfLayout(update.pdfLayout);
      updateSettings(update);
    },
    [updateSettings],
  );
  const { toc, currentPage, totalPages, bookProgress, goToPage, goNext, goPrev, loadError } =
    usePdfLifecycle({
      bookId: book.id,
      containerRef,
      loadData,
      initialPosition: currentCfi,
      persistPosition: false,
      pdfLayout,
      theme: resolvedTheme,
      fontSize: settings.fontSize,
      onRelocated: showToolbar,
    });

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="shared-pdf-reader">
      <PdfReaderView
        book={book}
        readOnly
        containerRef={containerRef}
        localSettings={localSettings}
        onUpdateSettings={onUpdateSettings}
        searchOpen={false}
        searchQuery=""
        searchResultCount={0}
        searchIndex={0}
        searchNext={() => {}}
        searchPrev={() => {}}
        onSearchOpen={() => {}}
        onSearchClose={() => {}}
        onSearchQueryChange={() => {}}
        isScrollMode={pdfLayout === "continuous"}
        isMobile={Boolean(isMobile)}
        toggleToolbar={toggleToolbar}
        goPrev={goPrev}
        goNext={goNext}
        toolbarVisible={toolbarVisible}
        totalPages={totalPages}
        currentPage={currentPage}
        bookProgress={bookProgress}
        toc={toc}
        tocOpen={tocOpen}
        setTocOpen={setTocOpen}
        goToPage={goToPage}
      />
      {loadError ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center"
          role="alert"
        >
          <p className="text-muted-foreground">
            Unable to load this book. Check your connection and try again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SharedBookReader({ shareId, fileUrl, format, currentCfi }: SharedBookReaderProps) {
  const loadData = useCallback(() => loadSharedFile(fileUrl), [fileUrl]);
  const book: BookMeta = {
    id: `share:${shareId}`,
    title: "",
    author: "",
    coverImage: null,
    format,
  };

  return format === "pdf" ? (
    <SharedPdfReader book={book} loadData={loadData} currentCfi={currentCfi} />
  ) : (
    <SharedEpubReader book={book} loadData={loadData} currentCfi={currentCfi} />
  );
}
