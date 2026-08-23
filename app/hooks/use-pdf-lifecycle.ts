import { useEffect, useRef, useCallback, useState } from "react";
import { resolveStartCfi } from "~/lib/position-utils";
import type { PdfLayout, Theme } from "~/lib/settings";
import { resolveTheme } from "~/lib/settings";
import { registerActiveReader, unregisterActiveReader } from "~/lib/sync/active-readers";
import type { TocEntry } from "~/lib/context/reader-context";
import { isEditableElement } from "~/lib/dom-utils";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";
import { usePositionNudge } from "~/hooks/use-position-nudge";
import { loadBookDataRequested } from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";
import {
  flushReadingPositionRequested,
  hydrateReadingPositionsRequested,
  readingPositionChanged,
  recordReadingHistoryRequested,
} from "~/lib/themis/reading-positions/reading-positions-slice";

export interface UsePdfLifecycleConfig {
  bookId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  loadData?: () => Promise<ArrayBuffer>;
  initialPosition?: string | null;
  persistPosition?: boolean;
  pdfLayout: PdfLayout;
  theme: Theme;
  fontSize: number;
  enabled?: boolean;
  panelId?: string;
  onTocExtracted?: (toc: TocEntry[]) => void;
  onCleanupToc?: () => void;
  onRelocated?: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  /** Called after pages have been rendered (e.g. to re-apply highlight overlays). */
  onAfterRender?: () => void;
}

export interface UsePdfLifecycleReturn {
  toc: TocEntry[];
  currentChapterLabel: string | null;
  currentPage: number;
  totalPages: number;
  bookProgress: number;
  hasRestoredPosition: boolean;
  loadError: boolean;
  goToPage: (page: number) => void;
  goNext: () => void;
  goPrev: () => void;
  flushPositionSave: () => void;
  pdfDocRef: React.RefObject<any>;
  /** Reference to the PDFViewer instance for search/highlight integration */
  viewerRef: React.RefObject<any>;
  /** Reference to the EventBus instance for search/highlight integration */
  eventBusRef: React.RefObject<any>;
}

export interface PdfChapterStart {
  label: string;
  page: number;
}

export function pdfChapterLabelForPage(
  chapterStarts: readonly PdfChapterStart[],
  currentPage: number,
): string | null {
  let current: PdfChapterStart | null = null;
  for (const start of chapterStarts) {
    if (start.page <= currentPage && (!current || start.page >= current.page)) current = start;
  }
  return current?.label ?? null;
}

async function pdfDestinationPage(doc: any, destination: unknown): Promise<number | null> {
  try {
    const resolved =
      typeof destination === "string" ? await doc.getDestination(destination) : destination;
    if (typeof resolved === "number") return resolved + 1;
    if (!Array.isArray(resolved) || resolved.length === 0) return null;
    const target = resolved[0];
    if (typeof target === "number") return target + 1;
    return (await doc.getPageIndex(target)) + 1;
  } catch {
    return null;
  }
}

async function pdfChapterStarts(doc: any, items: any[]): Promise<PdfChapterStart[]> {
  const starts: PdfChapterStart[] = [];
  for (const item of items) {
    const label = typeof item.title === "string" ? item.title.trim() : "";
    const page = label ? await pdfDestinationPage(doc, item.dest) : null;
    if (label && page !== null) starts.push({ label, page });
    if (item.items?.length) starts.push(...(await pdfChapterStarts(doc, item.items)));
  }
  return starts;
}

/** Map our PdfLayout setting to PDFViewer ScrollMode */
function layoutToScrollMode(layout: PdfLayout): number {
  // ScrollMode values: VERTICAL=0, PAGE=3
  if (layout === "continuous") return 0; // ScrollMode.VERTICAL
  if (layout === "two-page") return 3; // ScrollMode.PAGE — paired with SpreadMode.EVEN
  return 3; // ScrollMode.PAGE — single-page for all other modes
}

/** Map our PdfLayout setting to a pdf.js named scale value */
function layoutToScaleValue(layout: PdfLayout): string {
  switch (layout) {
    case "original":
      return "page-actual";
    case "fit-width":
      return "page-width";
    case "fit-height":
      return "page-fit";
    case "two-page":
      return "page-width";
    case "continuous":
      return "page-width";
    default:
      return "page-width";
  }
}

/** Apply layout-based scale and spread mode to a PDFViewer */
function applyLayoutToViewer(viewer: any, layout: PdfLayout): void {
  // SpreadMode: NONE=0, ODD=1, EVEN=2
  viewer.spreadMode = layout === "two-page" ? 2 : 0;
  viewer.scrollMode = layoutToScrollMode(layout);
  viewer.currentScaleValue = layoutToScaleValue(layout);
}

export function observePdfViewerResize(container: HTMLElement, getViewer: () => any): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};

  let rafId: number | null = null;
  const observer = new ResizeObserver(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const viewer = getViewer();
      if (!viewer || typeof viewer.update !== "function") return;

      const scaleValue = viewer.currentScaleValue;
      if (typeof scaleValue === "string" && Number.isNaN(Number(scaleValue))) {
        viewer.currentScaleValue = scaleValue;
      } else {
        viewer.update();
      }
    });
  });
  observer.observe(container);

  return () => {
    observer.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}

export function usePdfLifecycle(config: UsePdfLifecycleConfig): UsePdfLifecycleReturn {
  const {
    bookId,
    containerRef,
    pdfLayout,
    fontSize,
    enabled = true,
    panelId,
    loadData,
    initialPosition,
    persistPosition = true,
  } = config;

  const configRef = useRef(config);
  configRef.current = config;

  // Access workspace context to check if this book panel is active in focused mode
  const ws = useOptionalWorkspace();
  const store = useAppStore();

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [chapterStarts, setChapterStarts] = useState<PdfChapterStart[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const pdfDocRef = useRef<any>(null);
  const loadingTaskRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const eventBusRef = useRef<any>(null);
  const latestPageRef = useRef<number>(1);
  const hasRestoredPositionRef = useRef(false);

  const flushPositionSave = useCallback(() => {
    if (configRef.current.persistPosition === false) return;
    const page = latestPageRef.current;
    if (page > 0) {
      const panelId = configRef.current.panelId;
      store.dispatch(
        flushReadingPositionRequested({
          bookId,
          cfi: `page:${page}`,
          ...(panelId !== undefined ? { panelId } : {}),
        }),
      );
    }
  }, [bookId, store]);

  const savePositionDebounced = useCallback(
    (page: number) => {
      latestPageRef.current = page;
      if (configRef.current.persistPosition === false) return;
      const panelId = configRef.current.panelId;
      store.dispatch(
        readingPositionChanged({
          bookId,
          cfi: `page:${page}`,
          ...(panelId !== undefined ? { panelId } : {}),
        }),
      );
    },
    [bookId, store],
  );

  const goToPage = useCallback((page: number) => {
    const viewer = viewerRef.current;
    if (!viewer || page < 1 || page > (viewer.pagesCount || 0)) return;
    viewer.currentPageNumber = page;
  }, []);

  const goNext = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer) viewer.nextPage();
  }, []);

  const goPrev = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer) viewer.previousPage();
  }, []);

  const navigateToPosition = useCallback(
    (cfi: string) => {
      const match = /^page:([0-9]+)$/.exec(cfi);
      if (!match) return;
      goToPage(Number(match[1]));
    },
    [goToPage],
  );

  usePositionNudge({
    bookId,
    enabled: enabled && hasRestoredPosition && persistPosition,
    navigateToPosition,
  });

  // Main lifecycle effect — create PDFViewer and load document
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    setHasRestoredPosition(false);
    hasRestoredPositionRef.current = false;
    setLoadError(false);

    let cancelled = false;
    let restoredPageToSuppress: number | null = null;
    const disconnectResizeObserver = observePdfViewerResize(el, () => viewerRef.current);
    if (persistPosition) registerActiveReader(bookId);

    const init = async () => {
      // Load book data
      const bookData = loadData
        ? await loadData()
        : await new Promise<ArrayBuffer>((resolve, reject) => {
            store.dispatch(
              loadBookDataRequested(bookId, resolve, (error) => reject(new Error(error))),
            );
          });
      if (cancelled) return;

      // Setup pdfjs worker
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;

      // Import viewer components
      const pdfjsViewer = await import("pdfjs-dist/web/pdf_viewer.mjs");

      if (cancelled) return;

      // Create EventBus
      const eventBus = new pdfjsViewer.EventBus();
      eventBusRef.current = eventBus;

      // Create PDFLinkService
      const linkService = new pdfjsViewer.PDFLinkService({ eventBus });

      // Create PDFFindController
      const findController = new pdfjsViewer.PDFFindController({ linkService, eventBus });

      // Ensure container has the required inner div
      el.innerHTML = "";
      const viewerDiv = document.createElement("div");
      viewerDiv.className = "pdfViewer";
      el.appendChild(viewerDiv);

      // Determine dark mode page colors
      const isDark = resolveTheme(configRef.current.theme) === "dark";
      const pageColors = isDark ? { background: "#1a1a2e", foreground: "#e0e0e0" } : undefined;

      // Create PDFViewer
      const viewer = new pdfjsViewer.PDFViewer({
        container: el,
        viewer: viewerDiv,
        eventBus,
        linkService,
        findController,
        removePageBorders: true,
        pageColors: pageColors || undefined,
      });
      viewerRef.current = viewer;
      linkService.setViewer(viewer);

      // Set initial scroll/spread mode based on layout
      viewer.scrollMode = layoutToScrollMode(configRef.current.pdfLayout);
      viewer.spreadMode = configRef.current.pdfLayout === "two-page" ? 2 : 0;

      // Listen for page changes
      eventBus.on("pagechanging", (evt: any) => {
        const pageNum = evt.pageNumber;
        latestPageRef.current = pageNum;
        setCurrentPage(pageNum);
        savePositionDebounced(pageNum);
        configRef.current.onRelocated?.();
        if (!hasRestoredPositionRef.current || configRef.current.persistPosition === false) return;
        if (restoredPageToSuppress === pageNum) {
          restoredPageToSuppress = null;
          return;
        }
        restoredPageToSuppress = null;
        const pageCount = viewer.pagesCount || pdfDocRef.current?.numPages || null;
        store.dispatch(
          recordReadingHistoryRequested(bookId, {
            cfi: `page:${pageNum}`,
            chapterHref: null,
            chapterLabel: null,
            percentage: pageCount ? (pageNum / pageCount) * 100 : 0,
            pageIndex: pageNum,
            totalPages: pageCount,
          }),
        );
      });

      // Listen for pages rendered (for highlight overlay re-application)
      eventBus.on("pagerendered", () => {
        configRef.current.onAfterRender?.();
      });

      // Load PDF document
      const dataCopy = new Uint8Array(bookData).slice();
      const loadingTask = pdfjs.getDocument({ data: dataCopy });
      loadingTaskRef.current = loadingTask;
      const doc = await loadingTask.promise;
      if (cancelled) {
        return;
      }
      pdfDocRef.current = doc;
      setTotalPages(doc.numPages);

      // Set document on viewer
      viewer.setDocument(doc);
      linkService.setDocument(doc, null);
      findController.setDocument(doc);

      // Apply initial layout-based scale
      // Wait for first page to render before setting scale
      eventBus.on("pagesinit", () => {
        applyLayoutToViewer(viewer, configRef.current.pdfLayout);

        // Restore reading position
        const resolvePosition = persistPosition
          ? new Promise<void>((resolve, reject) => {
              const positionKeys = panelId === undefined ? [bookId] : [bookId, panelId];
              store.dispatch(
                hydrateReadingPositionsRequested(positionKeys, resolve, (error) =>
                  reject(new Error(error)),
                ),
              );
            }).then(() =>
              resolveStartCfi({
                latestCfi: latestPageRef.current > 1 ? `page:${latestPageRef.current}` : null,
                panelId,
                bookId,
                getPosition: async (key) =>
                  store.readingPositionsSelectors.selectPosition.select(store.state, key)?.cfi ??
                  null,
              }),
            )
          : Promise.resolve(initialPosition ?? null);
        resolvePosition
          .then((savedPos) => {
            let startPage = 1;
            if (savedPos && savedPos.startsWith("page:")) {
              const parsed = parseInt(savedPos.slice(5), 10);
              if (!isNaN(parsed) && parsed >= 1 && parsed <= doc.numPages) {
                startPage = parsed;
              }
            }
            restoredPageToSuppress = startPage;
            if (startPage > 1) {
              viewer.currentPageNumber = startPage;
            }
            latestPageRef.current = startPage;
            setCurrentPage(startPage);
            hasRestoredPositionRef.current = true;
            setHasRestoredPosition(true);
          })
          .catch((err) => console.error("Failed to restore PDF position:", err));
      });

      // Extract TOC from PDF outline
      try {
        const outline = await doc.getOutline();
        if (outline && outline.length > 0) {
          const mapOutline = (items: any[]): TocEntry[] =>
            items
              .filter((item) => item.title)
              .map((item) => ({
                label: item.title.trim(),
                href: JSON.stringify(item.dest),
                ...(item.items?.length ? { subitems: mapOutline(item.items) } : {}),
              }));
          const tocData = mapOutline(outline);
          setToc(tocData);
          configRef.current.onTocExtracted?.(tocData);
          const starts = await pdfChapterStarts(doc, outline);
          if (!cancelled) setChapterStarts(starts);
        }
      } catch {
        // Outline extraction is non-fatal
      }
    };

    init().catch((err) => {
      if (persistPosition) unregisterActiveReader(bookId);
      if (!cancelled) {
        setLoadError(true);
        console.error("Failed to load PDF:", err);
      }
    });

    // Keyboard navigation on the parent document
    // Arrow keys work globally (no focus check) so users don't need to click
    // the PDF viewer or navigation buttons first. In workspace/focused mode, we
    // only respond when this book is the active cluster; otherwise we respond
    // to all arrow keys. We always skip when typing in an editable element.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutToScrollMode(configRef.current.pdfLayout) === 0) return;
      if (isEditableElement()) return;

      // In workspace focused mode, only respond if this book is the active cluster
      if (ws && ws.activeClusterBookIdRef.current !== null) {
        if (ws.activeClusterBookIdRef.current !== bookId) return;
      }

      if (e.key === "ArrowLeft") {
        viewerRef.current?.previousPage();
      } else if (e.key === "ArrowRight") {
        viewerRef.current?.nextPage();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    // Flush the debounced position save on refresh/close — without this a
    // page turn within the debounce window is lost, and the server's older
    // position wins LWW on the next pull.
    window.addEventListener("pagehide", flushPositionSave);

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pagehide", flushPositionSave);
      disconnectResizeObserver();
      flushPositionSave();
      if (persistPosition) unregisterActiveReader(bookId);
      setToc([]);
      setChapterStarts([]);
      hasRestoredPositionRef.current = false;
      setHasRestoredPosition(false);
      configRef.current.onCleanupToc?.();

      // Cleanup viewer
      if (viewerRef.current) {
        viewerRef.current.cleanup();
        viewerRef.current = null;
      }
      eventBusRef.current = null;

      loadingTaskRef.current?.destroy().catch(() => {});
      loadingTaskRef.current = null;
      pdfDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bookId, flushPositionSave, initialPosition, loadData, panelId, persistPosition]);

  // Update scale when fontSize changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pdfDocRef.current) return;
    const zoomScale = fontSize / 100;
    viewer.currentScale = zoomScale;
  }, [fontSize]);

  // Update scroll mode, spread mode, and scale when pdfLayout changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pdfDocRef.current) return;
    applyLayoutToViewer(viewer, pdfLayout);
  }, [pdfLayout]);

  // Update page colors when theme changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pdfDocRef.current) return;
    const isDark = resolveTheme(config.theme) === "dark";
    const pageColors = isDark ? { background: "#1a1a2e", foreground: "#e0e0e0" } : null;
    viewer.pageColors = pageColors;
    // Force a refresh to apply new colors
    viewer.refresh(false);
  }, [config.theme]);

  const bookProgress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;
  const currentChapterLabel = pdfChapterLabelForPage(chapterStarts, currentPage);

  return {
    toc,
    currentChapterLabel,
    currentPage,
    totalPages,
    bookProgress,
    hasRestoredPosition,
    loadError,
    goToPage,
    goNext,
    goPrev,
    flushPositionSave,
    pdfDocRef,
    viewerRef,
    eventBusRef,
  };
}
