import { useEffect, useRef, useCallback, useState } from "react";
import { Effect } from "effect";
import { BookService } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { ReadingPositionService } from "~/lib/position-store";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";
import type { ReaderLayout, Theme } from "~/lib/settings";
import type { TocEntry } from "~/lib/reader-context";

const POSITION_SAVE_DEBOUNCE_MS = 1000;

export interface UsePdfLifecycleConfig {
  bookId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readerLayout: ReaderLayout;
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
}

export function usePdfLifecycle(config: UsePdfLifecycleConfig): UsePdfLifecycleReturn {
  const { bookId, containerRef, readerLayout, fontSize, enabled = true, panelId } = config;

  const configRef = useRef(config);
  configRef.current = config;

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const pdfDocRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPageRef = useRef<number>(1);
  const renderingRef = useRef(false);
  const layoutRef = useRef(readerLayout);
  layoutRef.current = readerLayout;
  const renderViewRef = useRef<(doc: any, page: number, layout: ReaderLayout) => Promise<void>>(
    async () => {},
  );

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
        savePosition: (key, val) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
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
          savePosition: (key, val) =>
            AppRuntime.runPromise(
              ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
            ),
        }).catch((err) => console.error("Failed to save PDF position:", err));
      }, POSITION_SAVE_DEBOUNCE_MS);
    },
    [bookId],
  );

  const renderPage = useCallback(
    async (doc: any, pageNum: number, wrapper: HTMLDivElement, scale: number) => {
      const pdfjs = await import("pdfjs-dist");
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      wrapper.appendChild(canvas);

      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Text layer for search/selection (Phase 3/4)
      const textContent = await page.getTextContent();
      const textDiv = document.createElement("div");
      textDiv.className = "pdf-text-layer";
      textDiv.style.cssText = "position:absolute;top:0;left:0;pointer-events:all;line-height:1;";
      textDiv.style.width = `${viewport.width}px`;
      textDiv.style.height = `${viewport.height}px`;
      textDiv.style.transformOrigin = "0 0";
      const containerWidth = wrapper.clientWidth || viewport.width;
      const scaleFactor = containerWidth / viewport.width;
      textDiv.style.transform = `scale(${scaleFactor})`;
      wrapper.appendChild(textDiv);

      const textLayer = new pdfjs.TextLayer({
        textContentSource: textContent,
        container: textDiv,
        viewport,
      });
      await textLayer.render();
      // Make text layer invisible but selectable
      textDiv.style.opacity = "0";

      page.cleanup();
    },
    [],
  );

  const renderView = useCallback(
    async (doc: any, page: number, layout: ReaderLayout) => {
      const el = containerRef.current;
      if (!el || renderingRef.current) return;
      renderingRef.current = true;

      try {
        el.innerHTML = "";
        const zoomScale = (fontSize / 100) * 1.5;

        if (layout === "scroll") {
          for (let i = 1; i <= doc.numPages; i++) {
            const pageWrapper = document.createElement("div");
            pageWrapper.className = "pdf-page-wrapper";
            pageWrapper.style.position = "relative";
            pageWrapper.style.marginBottom = "16px";
            pageWrapper.dataset.pageNumber = String(i);
            el.appendChild(pageWrapper);
            await renderPage(doc, i, pageWrapper, zoomScale);
          }
        } else {
          const pageWrapper = document.createElement("div");
          pageWrapper.className = "pdf-page-wrapper";
          pageWrapper.style.position = "relative";
          pageWrapper.style.maxWidth = "100%";
          pageWrapper.style.margin = "0 auto";
          el.appendChild(pageWrapper);
          await renderPage(doc, page, pageWrapper, zoomScale);
        }
      } finally {
        renderingRef.current = false;
        // Notify after render so highlight overlays can be re-applied
        configRef.current.onAfterRender?.();
      }
    },
    [containerRef, fontSize, renderPage],
  );

  // Keep ref in sync so main lifecycle effect doesn't depend on renderView identity
  renderViewRef.current = renderView;

  const goToPage = useCallback(
    (page: number) => {
      const doc = pdfDocRef.current;
      if (!doc || page < 1 || page > doc.numPages) return;
      setCurrentPage(page);
      latestPageRef.current = page;
      configRef.current.onRelocated?.();
      savePositionDebounced(page);

      if (layoutRef.current === "scroll") {
        const el = containerRef.current;
        if (!el) return;
        const pageEl = el.querySelector(`[data-page-number="${page}"]`);
        if (pageEl) pageEl.scrollIntoView({ behavior: "smooth" });
      } else {
        renderViewRef.current(doc, page, layoutRef.current);
      }
    },
    [savePositionDebounced, containerRef],
  );

  const goNext = useCallback(() => {
    goToPage(latestPageRef.current + 1);
  }, [goToPage]);

  const goPrev = useCallback(() => {
    goToPage(latestPageRef.current - 1);
  }, [goToPage]);

  // Main lifecycle effect
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;

    const init = async () => {
      const bookData = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getBookData(bookId))),
      );
      if (cancelled) return;

      const pdfjs = await import("pdfjs-dist");
      const workerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.href;

      const dataCopy = new Uint8Array(bookData).slice();
      const loadingTask = pdfjs.getDocument({ data: dataCopy });
      const doc = await loadingTask.promise;
      if (cancelled) {
        await doc.destroy();
        return;
      }
      pdfDocRef.current = doc;
      setTotalPages(doc.numPages);

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

      // Restore reading position
      const savedPos = await resolveStartCfi({
        latestCfi: latestPageRef.current > 1 ? `page:${latestPageRef.current}` : null,
        panelId,
        bookId,
        getPosition: (key) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition(key))),
          ),
      });

      let startPage = 1;
      if (savedPos && savedPos.startsWith("page:")) {
        const parsed = parseInt(savedPos.slice(5), 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= doc.numPages) {
          startPage = parsed;
        }
      }

      setCurrentPage(startPage);
      latestPageRef.current = startPage;
      await renderViewRef.current(doc, startPage, readerLayout);
    };

    init().catch((err) => {
      if (!cancelled) console.error("Failed to load PDF:", err);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      if (configRef.current.panelRef) {
        const panel = configRef.current.panelRef.current;
        if (!panel?.contains(document.activeElement) && document.activeElement !== panel) return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToPage(latestPageRef.current - 1);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToPage(latestPageRef.current + 1);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown);
      flushPositionSave();
      setToc([]);
      configRef.current.onCleanupToc?.();
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy().catch(() => {});
        pdfDocRef.current = null;
      }
    };
  }, [enabled, bookId, readerLayout, flushPositionSave, goToPage, panelId]);

  // Re-render on fontSize change
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc) return;
    renderView(doc, latestPageRef.current, readerLayout);
  }, [fontSize, renderView, readerLayout]);

  // Scroll mode: track current page from scroll position
  useEffect(() => {
    if (readerLayout !== "scroll") return;
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const wrappers = el.querySelectorAll(".pdf-page-wrapper");
      const containerRect = el.getBoundingClientRect();
      const midY = containerRect.top + containerRect.height / 2;

      for (const wrapper of wrappers) {
        const rect = wrapper.getBoundingClientRect();
        if (rect.top <= midY && rect.bottom >= midY) {
          const pageNum = parseInt((wrapper as HTMLElement).dataset.pageNumber || "1", 10);
          if (pageNum !== latestPageRef.current) {
            latestPageRef.current = pageNum;
            setCurrentPage(pageNum);
            savePositionDebounced(pageNum);
            configRef.current.onRelocated?.();
          }
          break;
        }
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [readerLayout, containerRef, savePositionDebounced]);

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
  };
}
