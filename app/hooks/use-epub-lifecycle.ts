import { useEffect, useRef, useCallback, useState } from "react";
import ePub from "epubjs";
import type EpubBook from "epubjs/types/book";
import type Rendition from "epubjs/types/rendition";
import { Effect } from "effect";
import { BookService } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { LocationCacheService } from "~/lib/location-cache-store";
import { ReadingPositionService } from "~/lib/position-store";
import { resolveTheme } from "~/lib/settings";
import type { ReaderLayout, Theme } from "~/lib/settings";
import { registerThemeColors, getThemeColorCss, injectThemeColors } from "~/lib/epub-theme-utils";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";
import { getTypographyCss, getRenditionOptions } from "~/lib/epub-rendering-utils";
import type { TocEntry } from "~/lib/reader-context";

const POSITION_SAVE_DEBOUNCE_MS = 1000;

export interface ChatContextEntry {
  currentChapterIndex: number;
  currentSpineHref: string;
  visibleText: string;
}

export interface UseEpubLifecycleConfig {
  bookId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  readerLayout: ReaderLayout;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: Theme;
  loadAndApplyHighlights: (rendition: Rendition) => Promise<void>;
  registerSelectionHandler: (rendition: Rendition) => void;
  /** Whether the epub should initialize. Default true. */
  enabled?: boolean;
  /** Panel ID for dual-key position save/restore (workspace only). */
  panelId?: string;
  /** Chat context map for tracking visible text per book (workspace only). */
  chatContextMap?: React.MutableRefObject<Map<string, ChatContextEntry>>;
  /** Called once rendition is ready (workspace only, for pending CFI drain). */
  onRenditionReady?: (navigateToCfi: (cfi: string) => void) => void;
  /** Called when TOC is extracted from the epub. */
  onTocExtracted?: (toc: TocEntry[]) => void;
  /** Called on cleanup to unregister TOC. */
  onCleanupToc?: () => void;
  /** Called when Cmd/Ctrl+F is pressed inside the epub iframe. */
  onSearchOpen?: () => void;
  /** Called on each relocated event (e.g. to flash toolbar on mobile). */
  onRelocated?: () => void;
  /** Scope keyboard arrow-key handler to a specific panel element. */
  panelRef?: React.RefObject<HTMLDivElement | null>;
  /** Optional external bookRef — if provided, the hook uses it instead of creating its own. */
  bookRef?: React.MutableRefObject<EpubBook | null>;
  /** Optional external renditionRef — if provided, the hook uses it instead of creating its own. */
  renditionRef?: React.MutableRefObject<Rendition | null>;
}

export interface UseEpubLifecycleReturn {
  bookRef: React.MutableRefObject<EpubBook | null>;
  renditionRef: React.MutableRefObject<Rendition | null>;
  toc: TocEntry[];
  bookProgress: number;
  currentPage: number | null;
  totalPages: number | null;
  navigateToCfi: (cfi: string) => void;
  flushPositionSave: () => void;
  latestCfiRef: React.MutableRefObject<string | null>;
}

export function useEpubLifecycle(config: UseEpubLifecycleConfig): UseEpubLifecycleReturn {
  const {
    bookId,
    containerRef,
    readerLayout,
    fontFamily,
    fontSize,
    lineHeight,
    theme,
    loadAndApplyHighlights,
    registerSelectionHandler,
    enabled = true,
    panelId,
  } = config;

  const internalBookRef = useRef<EpubBook | null>(null);
  const internalRenditionRef = useRef<Rendition | null>(null);
  const bookRef = config.bookRef ?? internalBookRef;
  const renditionRef = config.renditionRef ?? internalRenditionRef;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCfiRef = useRef<string | null>(null);

  const [toc, setToc] = useState<TocEntry[]>([]);
  const [bookProgress, setBookProgress] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);

  const layoutRef = useRef(readerLayout);
  layoutRef.current = readerLayout;
  const typographyRef = useRef({ fontFamily, fontSize, lineHeight });
  typographyRef.current = { fontFamily, fontSize, lineHeight };

  // Use a ref for the full config so optional callbacks don't trigger re-init
  const configRef = useRef(config);
  configRef.current = config;

  const flushPositionSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const cfi = latestCfiRef.current;
    if (cfi) {
      savePositionDualKey({
        panelId,
        bookId,
        cfi,
        savePosition: (key, val) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
          ),
      }).catch((err) => console.error("Failed to flush reading position:", err));
    }
  }, [bookId, panelId]);

  const navigateToCfi = useCallback((cfi: string) => {
    renditionRef.current?.display(cfi).catch((err: unknown) => {
      console.warn("CFI navigation failed:", err);
    });
  }, []);

  // Main epub lifecycle effect
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let epubBook: EpubBook | null = null;
    let rendition: Rendition | null = null;

    const init = async () => {
      const bookData = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((s) => s.getBookData(bookId))),
      );
      if (cancelled) return;

      const opts = getRenditionOptions(readerLayout);
      epubBook = ePub(bookData);
      bookRef.current = epubBook;

      // Inject layout fix CSS via spine hooks
      epubBook.spine.hooks.content.register((doc: Document, _section: any) => {
        const style = doc.createElement("style");
        style.textContent = `
        section[class*="titlepage"] h1,
        section[class*="titlepage"] p,
        section[class*="colophon"] h2,
        section[class*="imprint"] h2 {
          position: static !important;
          left: auto !important;
        }
        img {
          max-height: 95vh !important;
          max-width: 100% !important;
          object-fit: contain !important;
        }
      `;
        doc.head.appendChild(style);
      });

      rendition = epubBook.renderTo(el, {
        width: "100%",
        height: "100%",
        spread: opts.spread,
        flow: opts.flow,
        allowScriptedContent: true,
        ...("gap" in opts && { gap: opts.gap }),
      });
      renditionRef.current = rendition;

      // Inject Google Fonts, typography CSS, and styles into epub iframe
      rendition.hooks.content.register((contents: any) => {
        const doc = contents.document;
        const link = doc.createElement("link");
        link.rel = "stylesheet";
        link.href =
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Literata:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Source+Serif+4:wght@400;500;600;700&display=swap";
        doc.head.appendChild(link);

        const style = doc.createElement("style");
        style.id = "reader-typography";
        style.textContent = getTypographyCss(
          typographyRef.current.fontFamily,
          typographyRef.current.fontSize,
          typographyRef.current.lineHeight,
        );
        doc.head.appendChild(style);

        const highlightStyle = doc.createElement("style");
        highlightStyle.id = "reader-highlights";
        highlightStyle.textContent = `
        .epubjs-hl {
          background-color: rgba(255, 213, 79, 0.4) !important;
          cursor: pointer;
        }
        .search-hl {
          background-color: rgba(59, 130, 246, 0.25) !important;
        }
        .search-hl-current {
          background-color: rgba(59, 130, 246, 0.6) !important;
        }
      `;
        doc.head.appendChild(highlightStyle);

        const themeStyle = doc.createElement("style");
        themeStyle.id = "reader-theme-colors";
        themeStyle.textContent = getThemeColorCss(resolveTheme(configRef.current.theme));
        doc.head.appendChild(themeStyle);

        // Forward keyboard events from the epub iframe
        doc.addEventListener("keydown", (e: KeyboardEvent) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "f") {
            e.preventDefault();
            e.stopPropagation();
            configRef.current.onSearchOpen?.();
            return;
          }
          if (layoutRef.current === "scroll") return;
          if (e.key === "ArrowLeft") rendition!.prev();
          else if (e.key === "ArrowRight") rendition!.next();
        });
      });

      registerThemeColors(rendition);

      // Post-ready initialization (async continuation)
      await epubBook.ready;

      // Extract TOC
      const nav = epubBook.navigation;
      if (nav && nav.toc) {
        const mapToc = (items: any[]): TocEntry[] =>
          items.map((item) => ({
            label: item.label?.trim() ?? "",
            href: item.href ?? "",
            ...(item.subitems?.length ? { subitems: mapToc(item.subitems) } : {}),
          }));
        const tocData = mapToc(nav.toc);
        setToc(tocData);
        configRef.current.onTocExtracted?.(tocData);
      }

      // Restore reading position
      const startCfi = await resolveStartCfi({
        latestCfi: latestCfiRef.current,
        panelId,
        bookId,
        getPosition: (key) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.getPosition(key))),
          ),
      });
      await rendition.display(startCfi || undefined);

      // Populate chatContextMap eagerly
      if (configRef.current.chatContextMap) {
        let visibleText = "";
        try {
          const contents = (rendition as any).getContents?.() as any[];
          if (contents?.length > 0) {
            visibleText = contents
              .map((c: any) => c.document?.body?.textContent?.trim() ?? "")
              .filter(Boolean)
              .join("\n\n");
          }
        } catch {
          // fallback
        }
        const loc = rendition.currentLocation() as any;
        if (loc?.start) {
          configRef.current.chatContextMap.current.set(bookId, {
            currentChapterIndex: loc.start.index ?? 0,
            currentSpineHref: loc.start.href ?? "",
            visibleText,
          });
        }
      }

      const effectiveTheme = resolveTheme(configRef.current.theme);
      rendition.themes.select(effectiveTheme);
      await loadAndApplyHighlights(rendition);
      registerSelectionHandler(rendition);
      configRef.current.onRenditionReady?.(navigateToCfi);

      // Location cache
      try {
        const cachedLocations = await AppRuntime.runPromise(
          LocationCacheService.pipe(Effect.andThen((s) => s.getLocations(bookId))).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          ),
        );
        if (cachedLocations) {
          epubBook.locations.load(cachedLocations);
        } else {
          await epubBook.locations.generate(1500);
          const json = (epubBook.locations as any).save() as string;
          AppRuntime.runPromise(
            LocationCacheService.pipe(Effect.andThen((s) => s.saveLocations(bookId, json))),
          ).catch(console.error);
        }
        setTotalPages((epubBook.locations as any).total as number);
      } catch {
        // locations generation can fail silently
      }

      // Relocated event handler
      rendition.on(
        "relocated",
        (location: {
          start: {
            cfi: string;
            percentage: number;
            displayed: { page: number; total: number };
            index?: number;
            href?: string;
          };
        }) => {
          if (!renditionRef.current) return;
          configRef.current.onRelocated?.();
          setBookProgress(location.start.percentage * 100);
          const epubLocTotal = (bookRef.current?.locations as any)?.total as number | undefined;
          if (epubLocTotal && epubLocTotal > 0) {
            const locIndex = bookRef.current!.locations.locationFromCfi(location.start.cfi);
            if (typeof locIndex === "number" && locIndex >= 0) {
              setCurrentPage(locIndex + 1);
            } else {
              setCurrentPage(Math.max(1, Math.round(location.start.percentage * epubLocTotal)));
            }
            setTotalPages(epubLocTotal);
          }
          latestCfiRef.current = location.start.cfi;

          // Update chat context
          if (configRef.current.chatContextMap && location.start.index != null) {
            let visibleText = "";
            try {
              const contents = (renditionRef.current as any)?.getContents?.() as any[];
              if (contents?.length > 0) {
                visibleText = contents
                  .map((c: any) => c.document?.body?.textContent?.trim() ?? "")
                  .filter(Boolean)
                  .join("\n\n");
              }
            } catch {
              // fallback
            }
            configRef.current.chatContextMap.current.set(bookId, {
              currentChapterIndex: location.start.index,
              currentSpineHref: location.start.href ?? "",
              visibleText,
            });
          }

          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            savePositionDualKey({
              panelId: configRef.current.panelId,
              bookId,
              cfi: location.start.cfi,
              savePosition: (key, val) =>
                AppRuntime.runPromise(
                  ReadingPositionService.pipe(Effect.andThen((s) => s.savePosition(key, val))),
                ),
            }).catch((err) => console.error("Failed to save reading position:", err));
          }, POSITION_SAVE_DEBOUNCE_MS);
        },
      );
    }; // end init()

    // Keyboard navigation on the parent document
    const handleKeyDown = (e: KeyboardEvent) => {
      if (layoutRef.current === "scroll") return;
      if (configRef.current.panelRef) {
        const panel = configRef.current.panelRef.current;
        if (!panel?.contains(document.activeElement) && document.activeElement !== panel) return;
      }
      if (e.key === "ArrowLeft") rendition?.prev();
      else if (e.key === "ArrowRight") rendition?.next();
    };
    document.addEventListener("keydown", handleKeyDown);

    init().catch((err) => {
      if (!cancelled) console.error("Failed to load book data:", err);
    });

    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKeyDown);
      flushPositionSave();
      setToc([]);
      configRef.current.onCleanupToc?.();
      if (rendition) rendition.destroy();
      if (epubBook) epubBook.destroy();
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [
    enabled,
    bookId,
    readerLayout,
    loadAndApplyHighlights,
    registerSelectionHandler,
    flushPositionSave,
    navigateToCfi,
    panelId,
  ]);

  // Theme sync effect
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    registerThemeColors(rendition);
    const effectiveTheme = resolveTheme(theme);
    injectThemeColors(rendition, effectiveTheme);
    rendition.themes.select(effectiveTheme);
  }, [theme]);

  // Typography sync effect
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const css = getTypographyCss(fontFamily, fontSize, lineHeight);
    const contents = (rendition as any).getContents() as any[];
    contents.forEach((content: any) => {
      const doc = content.document;
      if (!doc) return;
      let style = doc.getElementById("reader-typography");
      if (!style) {
        style = doc.createElement("style");
        style.id = "reader-typography";
        doc.head.appendChild(style);
      }
      style.textContent = css;
    });
  }, [fontFamily, fontSize, lineHeight]);

  return {
    bookRef,
    renditionRef,
    toc,
    bookProgress,
    currentPage,
    totalPages,
    navigateToCfi,
    flushPositionSave,
    latestCfiRef,
  };
}
