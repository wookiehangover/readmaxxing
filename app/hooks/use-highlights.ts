import { useCallback, useEffect, useRef, useState } from "react";
import type { DecorationClickDetail, SelectionChangedDetail } from "@readmaxxing/epub-successor";
import { Effect } from "effect";
import { AnnotationService, type Highlight } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import { type Theme, resolveTheme } from "~/lib/settings";
import { useSyncListener } from "~/hooks/use-sync-listener";

const HIGHLIGHT_COLOR_LIGHT = "rgba(255, 213, 79, 0.6)";
const HIGHLIGHT_COLOR_DARK = "rgba(255, 220, 100, 0.8)";

function getHighlightColor(theme: Theme): string {
  return resolveTheme(theme) === "dark" ? HIGHLIGHT_COLOR_DARK : HIGHLIGHT_COLOR_LIGHT;
}

export interface SelectionPopover {
  position: { x: number; y: number };
  cfiRange: string;
  text: string;
}

interface UseHighlightsOptions {
  bookId: string;
  renditionRef: React.RefObject<SuccessorRenditionAdapter | null>;
  /** Called when a user clicks an existing highlight in the epub */
  onHighlightClick?: (highlight: Highlight) => void;
  /** Current theme setting — used to pick highlight color for dark/light mode */
  theme: Theme;
}

export function useHighlights({
  bookId,
  renditionRef,
  onHighlightClick,
  theme,
}: UseHighlightsOptions) {
  const highlightsRef = useRef<Map<string, Highlight>>(new Map());
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopover | null>(null);

  const onHighlightClickRef = useRef(onHighlightClick);
  onHighlightClickRef.current = onHighlightClick;

  const handleDecorationClick = useCallback((detail: DecorationClickDetail) => {
    const stored = Array.from(highlightsRef.current.values()).find(
      ({ id }) => id === detail.decoration.id,
    );
    if (!stored) return;
    setSelectionPopover(null);
    onHighlightClickRef.current?.(stored);
  }, []);

  /** Apply a single stored highlight through the successor decoration layer. */
  const applyHighlightToRendition = useCallback(
    (rendition: SuccessorRenditionAdapter, hl: Highlight) => {
      const locator = rendition.locatorFromCfi(hl.cfiRange, hl.text);
      if (!locator) {
        console.warn("Skipping invalid EPUB highlight CFI; stored highlight was preserved", {
          highlightId: hl.id,
        });
        return;
      }
      rendition.upsertDecoration({
        id: hl.id,
        locator,
        style: { variant: "highlight", color: getHighlightColor(theme) },
      });
    },
    [theme],
  );

  /** Load all highlights for the book from IndexedDB and apply them to the rendition. */
  const loadAndApplyHighlights = useCallback(
    async (rendition: SuccessorRenditionAdapter) => {
      const program = Effect.gen(function* () {
        const svc = yield* AnnotationService;
        return yield* svc.getHighlightsByBook(bookId);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("Failed to load highlights:", error);
            return [] as Highlight[];
          }),
        ),
      );
      const existing = await AppRuntime.runPromise(program);
      const hlMap = new Map<string, Highlight>();
      for (const hl of existing) {
        hlMap.set(hl.cfiRange, hl);
        applyHighlightToRendition(rendition, hl);
      }
      highlightsRef.current = hlMap;
    },
    [bookId, applyHighlightToRendition],
  );

  /** Register successor selection and decoration-click handlers. */
  const registerSelectionHandler = useCallback(
    (rendition: SuccessorRenditionAdapter) => {
      rendition.on("decoration-click", handleDecorationClick);
      rendition.on("selection-changed", (detail: SelectionChangedDetail) => {
        const { locator, text } = detail;
        const cfiRange = locator?.locations.cfi;
        if (!locator || !cfiRange || !text.trim()) {
          setSelectionPopover(null);
          return;
        }
        const contents = rendition.contentDocument;
        const selection = contents?.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const iframe = contents?.defaultView?.frameElement;
        if (!range || !(iframe instanceof HTMLElement)) return;
        const iframeRect = iframe.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();

        const x = iframeRect.left + rangeRect.left + rangeRect.width / 2;
        const y = iframeRect.top + rangeRect.bottom;

        setSelectionPopover({ position: { x, y }, cfiRange, text });
      });

      // Dismiss popover when user clicks inside the epub iframe without making a selection.
      // We need to attach to both already-loaded and future content documents because
      // this function is called after the initial content has loaded.
      const attachDismissListener = (doc: Document) => {
        doc.addEventListener("mousedown", () => {
          setTimeout(() => {
            const sel = doc.defaultView?.getSelection();
            if (!sel || sel.isCollapsed || !sel.toString().trim()) {
              setSelectionPopover(null);
            }
          }, 50);
        });
      };

      // Attach to already-loaded iframe documents
      try {
        for (const content of rendition.getContents()) attachDismissListener(content.document);
      } catch {
        // ignore if getContents isn't available
      }

      // Attach to future content (page turns load new iframe documents)
      rendition.hooks.content.register((contents) => attachDismissListener(contents.document));
    },
    [handleDecorationClick],
  );

  /** Create and persist a new highlight, apply it to the rendition. Returns the created highlight. */
  const saveHighlight = useCallback(async (): Promise<Highlight | null> => {
    const rendition = renditionRef.current;
    if (!selectionPopover || !rendition) return null;

    const { cfiRange, text } = selectionPopover;
    const color = getHighlightColor(theme);

    const highlight: Highlight = {
      id: crypto.randomUUID(),
      bookId,
      cfiRange,
      text,
      color,
      createdAt: Date.now(),
    };

    const saveProgram = Effect.gen(function* () {
      const svc = yield* AnnotationService;
      yield* svc.saveHighlight(highlight);
    });
    await AppRuntime.runPromise(saveProgram).catch(console.error);
    highlightsRef.current.set(cfiRange, highlight);
    applyHighlightToRendition(rendition, highlight);

    setSelectionPopover(null);

    // Clear the selection in the iframe
    rendition.getContents().forEach((content) => {
      const win = content.document?.defaultView;
      if (win) win.getSelection()?.removeAllRanges();
    });

    return highlight;
  }, [selectionPopover, bookId, renditionRef, applyHighlightToRendition]);

  // Incrementally sync highlights when sync pulls highlight data
  const highlightSyncVersion = useSyncListener(["highlight"]);
  useEffect(() => {
    if (highlightSyncVersion === 0) return;
    const rendition = renditionRef.current;
    if (!rendition) return;

    const program = Effect.gen(function* () {
      const svc = yield* AnnotationService;
      return yield* svc.getHighlightsByBook(bookId);
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("Failed to sync highlights:", error);
          return [] as Highlight[];
        }),
      ),
    );

    (async () => {
      try {
        const freshHighlights = await AppRuntime.runPromise(program);

        const existingIds = new Set(Array.from(highlightsRef.current.values()).map((h) => h.id));
        const freshIds = new Set(freshHighlights.map((h) => h.id));

        // Skip if nothing changed
        if (
          existingIds.size === freshIds.size &&
          [...freshIds].every((id) => existingIds.has(id))
        ) {
          return;
        }

        // Add only NEW highlights
        for (const hl of freshHighlights) {
          if (!highlightsRef.current.has(hl.cfiRange)) {
            highlightsRef.current.set(hl.cfiRange, hl);
            applyHighlightToRendition(rendition, hl);
          }
        }

        // Remove highlights that are no longer in fresh set (soft-deleted)
        const freshCfiRanges = new Set(freshHighlights.map((h) => h.cfiRange));
        for (const [cfiRange] of highlightsRef.current) {
          if (!freshCfiRanges.has(cfiRange)) {
            const existing = highlightsRef.current.get(cfiRange);
            if (existing) rendition.removeDecoration(existing.id);
            highlightsRef.current.delete(cfiRange);
          }
        }
      } catch (err) {
        console.error("Failed to sync highlights:", err);
      }
    })();
  }, [bookId, renditionRef, applyHighlightToRendition, highlightSyncVersion]);

  const dismissPopovers = useCallback(() => {
    setSelectionPopover(null);
  }, []);

  const removeHighlightDecoration = useCallback(
    (cfiRange: string) => {
      const highlight = highlightsRef.current.get(cfiRange);
      if (highlight) renditionRef.current?.removeDecoration(highlight.id);
      highlightsRef.current.delete(cfiRange);
    },
    [renditionRef],
  );

  const applyTemporaryHighlight = useCallback(
    (cfiRange: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const locator = rendition.locatorFromCfi(cfiRange);
      if (!locator) {
        console.warn("Skipping invalid temporary EPUB highlight CFI");
        return;
      }
      const id = `temporary-highlight-${crypto.randomUUID()}`;
      rendition.upsertDecoration({
        id,
        locator,
        style: { variant: "highlight", color: "rgba(255, 213, 79, 0.4)" },
      });
      setTimeout(() => rendition.removeDecoration(id), 3000);
    },
    [renditionRef],
  );

  return {
    selectionPopover,
    saveHighlight,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
    removeHighlightDecoration,
    applyTemporaryHighlight,
  };
}
