import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, TableOfContents } from "lucide-react";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import { TocList } from "~/components/book-list";
import { ReaderFormattingMenu } from "~/components/reader-settings-menu";
import { EpubReaderSurface } from "~/components/workspace-book-reader/epub-reader-chrome";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { useEpubLifecycle } from "~/hooks/use-epub-lifecycle";
import { usePdfLifecycle } from "~/hooks/use-pdf-lifecycle";
import type { TocEntry } from "~/lib/context/reader-context";
import {
  useResolvedTheme,
  useSettings,
  type PdfLayout,
  type ReaderLayout,
  type Settings,
} from "~/lib/settings";
import type { BookFormat } from "~/lib/stores/book-store";

interface SharedBookReaderProps {
  shareId: string;
  fileUrl: string;
  format: BookFormat;
  currentCfi: string | null;
}

interface SharedReaderToolbarProps {
  currentPage: number | null;
  totalPages: number | null;
  toc: TocEntry[];
  onNavigateToToc: (href: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  settings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  isPdf?: boolean;
}

async function loadSharedFile(fileUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Unable to load shared file (${response.status})`);
  return response.arrayBuffer();
}

function SharedReaderToolbar({
  currentPage,
  totalPages,
  toc,
  onNavigateToToc,
  onPrevious,
  onNext,
  settings,
  onUpdateSettings,
  isPdf,
}: SharedReaderToolbarProps) {
  const [tocOpen, setTocOpen] = useState(false);

  return (
    <div className="relative flex h-10 shrink-0 items-center justify-center border-t px-2">
      <span className="absolute left-2 text-xs text-muted-foreground tabular-nums">
        {currentPage !== null && totalPages !== null && totalPages > 0
          ? `${currentPage} / ${totalPages}`
          : "Reading"}
      </span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={onPrevious}>
          <ChevronLeft />
          <span className="sr-only">Previous page</span>
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onNext}>
          <ChevronRight />
          <span className="sr-only">Next page</span>
        </Button>
      </div>
      <div className="absolute right-2 flex items-center gap-1">
        {toc.length > 0 && (
          <Popover open={tocOpen} onOpenChange={setTocOpen}>
            <PopoverTrigger
              render={
                <Button type="button" variant="ghost" size="icon" title="Table of Contents" />
              }
            >
              <TableOfContents />
              <span className="sr-only">Table of Contents</span>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="max-h-80 w-64 overflow-y-auto p-1.5">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Table of Contents
              </p>
              <ul>
                <TocList
                  entries={toc}
                  onNavigate={(href) => {
                    onNavigateToToc(href);
                    setTocOpen(false);
                  }}
                />
              </ul>
            </PopoverContent>
          </Popover>
        )}
        <ReaderFormattingMenu
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          isPdf={isPdf}
        />
      </div>
    </div>
  );
}

function SharedEpubReader({
  shareId,
  loadData,
  currentCfi,
}: {
  shareId: string;
  loadData: () => Promise<ArrayBuffer>;
  currentCfi: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<SuccessorRenditionAdapter | null>(null);
  const [settings, updateSettings] = useSettings();
  const resolvedTheme = useResolvedTheme(settings.theme);
  const [readerLayout, setReaderLayout] = useState<ReaderLayout>("spread");
  const localSettings = { ...settings, readerLayout };
  const onUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      if (update.readerLayout) setReaderLayout(update.readerLayout);
      updateSettings(update);
    },
    [updateSettings],
  );
  const {
    toc,
    currentPage,
    totalPages,
    loadError,
    navigateToTocHref,
    navigationInProgressRef,
    markNavigationInProgress,
  } = useEpubLifecycle({
    bookId: `share:${shareId}`,
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
        isMobile={false}
        toggleToolbar={() => {}}
        onPrevious={() => go("prev")}
        onNext={() => go("next")}
      />
      <SharedReaderToolbar
        currentPage={currentPage}
        totalPages={totalPages}
        toc={toc}
        onNavigateToToc={navigateToTocHref}
        onPrevious={() => go("prev")}
        onNext={() => go("next")}
        settings={localSettings}
        onUpdateSettings={onUpdateSettings}
      />
    </div>
  );
}

function SharedPdfReader({
  shareId,
  loadData,
  currentCfi,
}: {
  shareId: string;
  loadData: () => Promise<ArrayBuffer>;
  currentCfi: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [settings, updateSettings] = useSettings();
  const resolvedTheme = useResolvedTheme(settings.theme);
  const [pdfLayout, setPdfLayout] = useState<PdfLayout>(settings.pdfLayout);
  const localSettings = { ...settings, pdfLayout };
  const onUpdateSettings = useCallback(
    (update: Partial<Settings>) => {
      if (update.pdfLayout) setPdfLayout(update.pdfLayout);
      updateSettings(update);
    },
    [updateSettings],
  );
  const { toc, currentPage, totalPages, goToPage, goNext, goPrev, loadError } = usePdfLifecycle({
    bookId: `share:${shareId}`,
    containerRef,
    loadData,
    initialPosition: currentCfi,
    persistPosition: false,
    pdfLayout,
    theme: resolvedTheme,
    fontSize: settings.fontSize,
  });
  const navigateToToc = useCallback(
    (href: string) => {
      try {
        const destination = JSON.parse(href);
        const page =
          typeof destination === "number"
            ? destination
            : Array.isArray(destination) && typeof destination[0] === "number"
              ? destination[0]
              : null;
        if (page !== null) goToPage(page + 1);
      } catch {
        // Ignore malformed PDF outline destinations.
      }
    },
    [goToPage],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="shared-pdf-reader">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-auto"
          data-testid="pdf-container"
        />
        {loadError && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-background p-6 text-center"
            role="alert"
          >
            <p className="text-muted-foreground">
              Unable to load this book. Check your connection and try again.
            </p>
          </div>
        )}
      </div>
      <SharedReaderToolbar
        currentPage={currentPage}
        totalPages={totalPages}
        toc={toc}
        onNavigateToToc={navigateToToc}
        onPrevious={goPrev}
        onNext={goNext}
        settings={localSettings}
        onUpdateSettings={onUpdateSettings}
        isPdf
      />
    </div>
  );
}

export function SharedBookReader({ shareId, fileUrl, format, currentCfi }: SharedBookReaderProps) {
  const loadData = useCallback(() => loadSharedFile(fileUrl), [fileUrl]);

  return format === "pdf" ? (
    <SharedPdfReader shareId={shareId} loadData={loadData} currentCfi={currentCfi} />
  ) : (
    <SharedEpubReader shareId={shareId} loadData={loadData} currentCfi={currentCfi} />
  );
}
