import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNavigator,
  openPublication,
  openZipResourceProvider,
  type Navigator,
  type NavigatorPreferences,
  type PersistentLocator,
  type Relocation,
  type ZipResourceProvider,
} from "@readmaxxing/epub-successor";
import { Effect } from "effect";
import { toast } from "sonner";
import { usePositionNudge } from "~/hooks/use-position-nudge";
import { useOptionalWorkspace } from "~/lib/context/workspace-context";
import type { TocEntry } from "~/lib/context/reader-context";
import { isEditableElement } from "~/lib/dom-utils";
import { AppRuntime } from "~/lib/effect-runtime";
import { getTypographyCss } from "~/lib/epub/epub-rendering-utils";
import { getThemeColorCss } from "~/lib/epub/epub-theme-utils";
import {
  createSuccessorBookAdapter,
  extractCompatibleToc,
  generateSuccessorPositions,
  parseSuccessorPositionCache,
  serializeSuccessorPositionCache,
  spineIndexFromCfi,
  SuccessorRenditionAdapter,
} from "~/lib/epub/successor-reader-adapter";
import {
  logicalChapterIndex,
  normalizeEpubHref,
  resolveCurrentChapterLabel,
  resolveTocNavigationTarget,
  type ReaderBookLike,
  type TocNavigationTarget,
} from "~/lib/epub/successor-toc";
import { resolveStartCfi, savePositionDualKey } from "~/lib/position-utils";
import { resolveTheme } from "~/lib/settings";
import type { ReaderLayout, TextAlign, Theme } from "~/lib/settings";
import { BookService } from "~/lib/stores/book-store";
import { LocationCacheService } from "~/lib/stores/location-cache-store";
import { ReadingHistoryService } from "~/lib/stores/reading-history-store";
import { ReadingPositionService } from "~/lib/stores/position-store";
import { registerActiveReader, unregisterActiveReader } from "~/lib/sync/active-readers";

export { resolveTocNavigationTarget } from "~/lib/epub/successor-toc";
export type { TocNavigationTarget } from "~/lib/epub/successor-toc";

const POSITION_SAVE_DEBOUNCE_MS = 1000;

interface CfiDisplayTarget {
  display(target?: string | number): Promise<unknown>;
}

export async function displayStoredCfiWithFallback(
  rendition: CfiDisplayTarget,
  cfi: string,
  onFallback: (error: unknown) => void,
): Promise<void> {
  try {
    await rendition.display(cfi);
  } catch (error) {
    onFallback(error);
    await rendition.display(spineIndexFromCfi(cfi) ?? 0);
  }
}

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
  textAlign: TextAlign;
  theme: Theme;
  loadAndApplyHighlights: (rendition: SuccessorRenditionAdapter) => Promise<void>;
  registerSelectionHandler: (rendition: SuccessorRenditionAdapter) => void;
  enabled?: boolean;
  panelId?: string;
  chatContextMap?: React.MutableRefObject<Map<string, ChatContextEntry>>;
  onRenditionReady?: (navigateToCfi: (cfi: string) => void) => void;
  onTocExtracted?: (toc: TocEntry[]) => void;
  onCleanupToc?: () => void;
  onSearchOpen?: () => void;
  onRelocated?: () => void;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  bookRef?: React.MutableRefObject<any | null>;
  renditionRef?: React.MutableRefObject<any | null>;
}

export interface UseEpubLifecycleReturn {
  bookRef: React.MutableRefObject<any | null>;
  renditionRef: React.MutableRefObject<any | null>;
  navigationInProgressRef: React.MutableRefObject<boolean>;
  markNavigationInProgress: () => void;
  toc: TocEntry[];
  currentChapterLabel: string | null;
  bookProgress: number;
  currentPage: number | null;
  totalPages: number | null;
  navigateToCfi: (cfi: string) => void;
  navigateToTocHref: (href: string) => void;
  flushPositionSave: () => void;
  latestCfiRef: React.MutableRefObject<string | null>;
}

function readerPreferences(config: UseEpubLifecycleConfig): NavigatorPreferences {
  const layout = config.readerLayout;
  const theme = resolveTheme(config.theme);
  return {
    flow: layout === "scroll" ? "scrolled" : "paginated",
    spread: layout === "spread" ? "double" : "single",
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    lineHeight: config.lineHeight,
    theme,
    preferenceCss: `${getTypographyCss(
      config.fontFamily,
      config.fontSize,
      config.lineHeight,
      config.textAlign,
    )}\n${getThemeColorCss(theme)}`,
    readerBaseCss: `
      html, body { box-sizing: border-box; margin: 0; min-height: 100%; }
      body { overflow-wrap: anywhere; }
      section[class*="titlepage"] h1, section[class*="titlepage"] p,
      section[class*="colophon"] h2, section[class*="imprint"] h2 {
        position: static !important; left: auto !important;
      }
      .search-hl { background-color: rgba(59,130,246,.25) !important; }
      .search-hl-current { background-color: rgba(59,130,246,.6) !important; }
    `,
  };
}

function mapToc(
  entries: readonly { title: string; href: string; children: readonly any[] }[],
): TocEntry[] {
  return entries.map((entry) => ({
    label: entry.title.trim(),
    href: entry.href,
    ...(entry.children.length ? { subitems: mapToc(entry.children) } : {}),
  }));
}

function pageForProgression(totalProgression: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(total, Math.max(1, Math.floor(totalProgression * total) + 1));
}

export function useEpubLifecycle(config: UseEpubLifecycleConfig): UseEpubLifecycleReturn {
  const { bookId, containerRef, enabled = true } = config;
  const internalBookRef = useRef<any | null>(null);
  const internalRenditionRef = useRef<any | null>(null);
  const bookRef = config.bookRef ?? internalBookRef;
  const renditionRef = config.renditionRef ?? internalRenditionRef;
  const navigatorRef = useRef<Navigator | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const latestCfiRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationInProgressRef = useRef(false);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressPositionSaveRef = useRef(false);
  const warnedBrokenTocBookIdsRef = useRef(new Set<string>());
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [currentChapterLabel, setCurrentChapterLabel] = useState<string | null>(null);
  const [bookProgress, setBookProgress] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const ws = useOptionalWorkspace();

  const clearNavigationInProgress = useCallback(() => {
    navigationInProgressRef.current = false;
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    navigationTimeoutRef.current = null;
  }, []);

  const markNavigationInProgress = useCallback(() => {
    navigationInProgressRef.current = true;
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    navigationTimeoutRef.current = setTimeout(clearNavigationInProgress, 3000);
  }, [clearNavigationInProgress]);

  const flushPositionSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const cfi = latestCfiRef.current;
    if (!cfi) return;
    savePositionDualKey({
      panelId: undefined,
      bookId,
      cfi,
      savePosition: (key, value, options) =>
        AppRuntime.runPromise(
          ReadingPositionService.pipe(
            Effect.andThen((service) => service.savePosition(key, value, options)),
          ),
        ),
    }).catch((error) => console.error("Failed to flush reading position:", error));
  }, [bookId]);

  const displayCfiWithFallback = useCallback(
    async (rendition: SuccessorRenditionAdapter, cfi: string) => {
      suppressPositionSaveRef.current = true;
      try {
        await displayStoredCfiWithFallback(rendition, cfi, (error) => {
          console.warn("Stored EPUB CFI could not be resolved; falling back to spine start", {
            bookId,
            cfi,
            error,
          });
        });
      } finally {
        suppressPositionSaveRef.current = false;
      }
    },
    [bookId],
  );

  const navigateToCfi = useCallback(
    (cfi: string) => {
      const rendition = renditionRef.current as SuccessorRenditionAdapter | null;
      if (!rendition) return;
      markNavigationInProgress();
      void displayCfiWithFallback(rendition, cfi).catch((error) => {
        clearNavigationInProgress();
        console.warn("CFI navigation failed:", error);
      });
    },
    [clearNavigationInProgress, displayCfiWithFallback, markNavigationInProgress, renditionRef],
  );

  const navigateToTocHref = useCallback(
    (href: string) => {
      const book = bookRef.current as ReaderBookLike | null;
      const rendition = renditionRef.current as SuccessorRenditionAdapter | null;
      if (!book || !rendition) return;
      const tryDisplay = async (target: string | number) => {
        markNavigationInProgress();
        try {
          await rendition.display(target);
          return true;
        } catch {
          clearNavigationInProgress();
          return false;
        }
      };
      void (async () => {
        if (await tryDisplay(href)) return;
        const normalized = normalizeEpubHref(href);
        if (normalized !== href && (await tryDisplay(normalized))) return;
        const target: TocNavigationTarget = resolveTocNavigationTarget(book, toc, href);
        if (target.kind === "spineIndex" && (await tryDisplay(target.index))) return;
        if (target.kind === "fallback" && (await tryDisplay(target.href))) return;
        if (!warnedBrokenTocBookIdsRef.current.has(bookId)) {
          warnedBrokenTocBookIdsRef.current.add(bookId);
          console.warn("TOC navigation failed:", { bookId, href });
          toast("This book's table of contents may have broken links.");
        }
      })();
    },
    [bookId, bookRef, clearNavigationInProgress, markNavigationInProgress, renditionRef, toc],
  );

  usePositionNudge({
    bookId,
    enabled: enabled && hasRestoredPosition,
    navigateToPosition: navigateToCfi,
  });

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    const container = containerRef.current;
    const controller = new AbortController();
    let cancelled = false;
    let provider: ZipResourceProvider | null = null;
    let rendition: SuccessorRenditionAdapter | null = null;
    let bookAdapter: ReaderBookLike | null = null;
    let tocData: TocEntry[] = [];
    let positions: readonly PersistentLocator[] = [];
    registerActiveReader(bookId);
    setHasRestoredPosition(false);

    const saveRelocation = (cfi: string) => {
      savePositionDualKey({
        panelId: configRef.current.panelId,
        bookId,
        cfi,
        recordChange: false,
        savePosition: (key, value, options) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(
              Effect.andThen((service) => service.savePosition(key, value, options)),
            ),
          ),
      }).catch((error) => console.error("Failed to save local reading position:", error));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(flushPositionSave, POSITION_SAVE_DEBOUNCE_MS);
    };

    const handleRelocation = (relocation: Relocation) => {
      if (!rendition || !bookAdapter || cancelled) return;
      configRef.current.onRelocated?.();
      clearNavigationInProgress();
      const location = rendition.location?.start;
      if (!location) return;
      const page = pageForProgression(relocation.totalProgression, positions.length);
      const chapterLabel = resolveCurrentChapterLabel(
        tocData,
        bookAdapter,
        relocation.href,
        relocation.spineIndex,
      );
      setBookProgress(relocation.totalProgression * 100);
      setCurrentPage(page);
      setTotalPages(positions.length || null);
      setCurrentChapterLabel(chapterLabel);
      if (configRef.current.chatContextMap) {
        const visibleText = rendition.contentDocument?.body?.textContent?.trim() ?? "";
        configRef.current.chatContextMap.current.set(bookId, {
          currentChapterIndex: logicalChapterIndex(tocData, bookAdapter, relocation.spineIndex),
          currentSpineHref: relocation.href,
          visibleText,
        });
      }
      if (suppressPositionSaveRef.current) return;
      latestCfiRef.current = location.cfi;
      saveRelocation(location.cfi);
      AppRuntime.runPromise(
        ReadingHistoryService.pipe(
          Effect.andThen((service) =>
            service.recordVisit(bookId, {
              cfi: location.cfi,
              chapterHref: relocation.href,
              chapterLabel,
              percentage: relocation.totalProgression * 100,
              pageIndex: page,
              totalPages: positions.length || null,
            }),
          ),
        ),
      ).catch(console.error);
    };

    const init = async () => {
      const data = await AppRuntime.runPromise(
        BookService.pipe(Effect.andThen((service) => service.getBookData(bookId))),
      );
      if (cancelled) return;
      provider = await openZipResourceProvider(data, { signal: controller.signal });
      const opened = await openPublication(provider, { signal: controller.signal });
      if (!opened.publication) throw new Error("EPUB publication could not be parsed");
      const publication = opened.publication;
      tocData = mapToc(await extractCompatibleToc(publication, provider));
      const compatibilityBook = createSuccessorBookAdapter(publication, provider);
      bookAdapter = compatibilityBook as unknown as ReaderBookLike;
      bookRef.current = compatibilityBook;
      const navigator = createNavigator(publication, {
        container,
        preferences: readerPreferences(configRef.current),
        security: { resourceProvider: provider },
      });
      navigatorRef.current = navigator;
      rendition = new SuccessorRenditionAdapter(publication, navigator);
      renditionRef.current = rendition;
      navigator.addEventListener("relocation", (event) =>
        handleRelocation((event as CustomEvent<Relocation>).detail),
      );
      setToc(tocData);
      configRef.current.onTocExtracted?.(tocData);

      const cached = await AppRuntime.runPromise(
        LocationCacheService.pipe(Effect.andThen((service) => service.getLocations(bookId))).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      );
      const successorCache = parseSuccessorPositionCache(cached);
      positions =
        successorCache?.positions ?? (await generateSuccessorPositions(publication, provider));
      if (!successorCache) {
        void AppRuntime.runPromise(
          LocationCacheService.pipe(
            Effect.andThen((service) =>
              service.saveLocations(bookId, serializeSuccessorPositionCache(positions)),
            ),
          ),
        ).catch(console.error);
      }

      const observedDocuments = new WeakSet<Document>();
      rendition.hooks.content.register(({ document }: { document: Document }) => {
        if (observedDocuments.has(document)) return;
        observedDocuments.add(document);
        document.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "f") {
            event.preventDefault();
            configRef.current.onSearchOpen?.();
          } else if (configRef.current.readerLayout !== "scroll" && event.key === "ArrowLeft") {
            markNavigationInProgress();
            void rendition?.prev().catch(clearNavigationInProgress);
          } else if (configRef.current.readerLayout !== "scroll" && event.key === "ArrowRight") {
            markNavigationInProgress();
            void rendition?.next().catch(clearNavigationInProgress);
          }
        });
      });

      const startCfi = await resolveStartCfi({
        latestCfi: latestCfiRef.current,
        panelId: configRef.current.panelId,
        bookId,
        getPosition: (key) =>
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((service) => service.getPosition(key))),
          ),
      });
      suppressPositionSaveRef.current = true;
      try {
        if (startCfi) await displayCfiWithFallback(rendition, startCfi);
        else await rendition.display();
      } finally {
        suppressPositionSaveRef.current = false;
      }
      if (cancelled) return;
      setHasRestoredPosition(true);
      await configRef.current.loadAndApplyHighlights(rendition);
      configRef.current.registerSelectionHandler(rendition);
      configRef.current.onRenditionReady?.(navigateToCfi);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (configRef.current.readerLayout === "scroll" || isEditableElement()) return;
      if (ws?.activeClusterBookIdRef.current && ws.activeClusterBookIdRef.current !== bookId)
        return;
      if (!rendition || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      markNavigationInProgress();
      void (event.key === "ArrowLeft" ? rendition.prev() : rendition.next()).catch((error) => {
        clearNavigationInProgress();
        console.error("Failed to navigate publication", error);
      });
    };
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pagehide", flushPositionSave);
    void init().catch((error) => {
      unregisterActiveReader(bookId);
      if (!cancelled) console.error("Failed to load book data:", error);
    });

    return () => {
      cancelled = true;
      controller.abort();
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pagehide", flushPositionSave);
      flushPositionSave();
      clearNavigationInProgress();
      unregisterActiveReader(bookId);
      setToc([]);
      setHasRestoredPosition(false);
      setCurrentChapterLabel(null);
      configRef.current.onCleanupToc?.();
      rendition?.destroy();
      provider?.close();
      navigatorRef.current = null;
      bookRef.current = null;
      renditionRef.current = null;
    };
  }, [
    bookId,
    bookRef,
    clearNavigationInProgress,
    containerRef,
    displayCfiWithFallback,
    enabled,
    flushPositionSave,
    markNavigationInProgress,
    navigateToCfi,
    renditionRef,
    ws,
  ]);

  useEffect(() => {
    const navigator = navigatorRef.current;
    if (!navigator) return;
    void navigator
      .setPreferences(readerPreferences(config))
      .catch((error) => console.error("Failed to update reader preferences", error));
  }, [
    config.fontFamily,
    config.fontSize,
    config.lineHeight,
    config.readerLayout,
    config.textAlign,
    config.theme,
  ]);

  return {
    bookRef,
    renditionRef,
    navigationInProgressRef,
    markNavigationInProgress,
    toc,
    currentChapterLabel,
    bookProgress,
    currentPage,
    totalPages,
    navigateToCfi,
    navigateToTocHref,
    flushPositionSave,
    latestCfiRef,
  };
}
