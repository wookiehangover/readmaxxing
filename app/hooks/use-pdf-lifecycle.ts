import { useEffect, useRef, useCallback, useState } from "react";
import { Effect } from "effect";
import { BookService } from "~/lib/stores/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { ReadingPositionService } from "~/lib/stores/position-store";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";
import type { PdfLayout, Theme } from "~/lib/settings";
import { resolveTheme } from "~/lib/settings";
import type { TocEntry } from "~/lib/context/reader-context";

const POSITION_SAVE_DEBOUNCE_MS = 1000;

export interface UsePdfLifecycleConfig {
  bookId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
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
  currentPage: number;
  totalPages: number;
  bookProgress: number;
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

export function usePdfLifecycle(config: UsePdfLifecycleConfig): UsePdfLifecycleReturn {
  const { bookId, containerRef, pdfLayout, fontSize, enabled = true, panelId } = config;

  const configRef = useRef(config);
  configRef.current = config;

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const pdfDocRef = useRef<any>(null);
  const viewerRef = useRef<any>(null);
  const eventBusRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPageRef = useRef<number>(1);

  const flushPositionSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const page = latestPageRef.current;
    if (page > 0) {
      savePositionDualKey({
        panelId,
        bookId,
        cfi: `page:${page}`,
        savePosition: (key, val, options) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val, options))),
          ),
      }).catch((err) => console.error("Failed to flush PDF position:", err));
    }
  }, [bookId, panelId]);

  const savePositionDebounced = useCallback(
    (page: number) => {
      latestPageRef.current = page;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        savePositionDualKey({
          panelId: configRef.current.panelId,
          bookId,
          cfi: `page:${page}`,
          savePosition: (key, val, options) =>
            AppRuntime.runPromise(
              ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val, options))),
            ),
        }).catch((err) => console.error("Failed to save PDF position:", err));
      }, POSITION_SAVE_DEBOUNCE_MS);
    },
    [bookId],
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

  // Main lifecycle effect — create PDFViewer and load document
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;

    const init = async () => {
      // Load book data
      const bookData = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getBookData(bookId))),
      );
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
      });

      // Listen for pages rendered (for highlight overlay re-application)
      eventBus.on("pagerendered", () => {
        configRef.current.onAfterRender?.();
      });

      // Load PDF document
      const dataCopy = new Uint8Array(bookData).slice();
      const loadingTask = pdfjs.getDocument({ data: dataCopy });
      const doc = await loadingTask.promise;
      if (cancelled) {
        await doc.destroy();
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
        resolveStartCfi({
          latestCfi: latestPageRef.current > 1 ? `page:${latestPageRef.current}` : null,
          panelId,
          bookId,
          getPosition: (key) =>
            AppRuntime.runPromise(
              ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition(key))),
            ),
        })
          .then((savedPos) => {
            let startPage = 1;
            if (savedPos && savedPos.startsWith("page:")) {
              const parsed = parseInt(savedPos.slice(5), 10);
              if (!isNaN(parsed) && parsed >= 1 && parsed <= doc.numPages) {
                startPage = parsed;
              }
            }
            if (startPage > 1) {
              viewer.currentPageNumber = startPage;
            }
            latestPageRef.current = startPage;
            setCurrentPage(startPage);
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
        }
      } catch {
        // Outline extraction is non-fatal
      }
    };

    init().catch((err) => {
      if (!cancelled) console.error("Failed to load PDF:", err);
    });

    return () => {
      cancelled = true;
      flushPositionSave();
      setToc([]);
      configRef.current.onCleanupToc?.();

      // Cleanup viewer
      if (viewerRef.current) {
        viewerRef.current.cleanup();
        viewerRef.current = null;
      }
      eventBusRef.current = null;

      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch(() => {});
        pdfDocRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bookId, flushPositionSave, panelId]);

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

  return {
    toc,
    currentPage,
    totalPages,
    bookProgress,
    goToPage,
    goNext,
    goPrev,
    flushPositionSave,
    pdfDocRef,
    viewerRef,
    eventBusRef,
  };
}
