import { useCallback, useEffect, useRef, useState } from "react";
import type { DecorationClickDetail, SelectionChangedDetail } from "@readmaxxing/epub-successor";
import type { Highlight } from "~/lib/stores/annotations-store";
import type { SuccessorRenditionAdapter } from "~/lib/epub/successor-reader-adapter";
import { type Theme, resolveTheme } from "~/lib/settings";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useAppStore } from "~/lib/themis/provider";
import {
  addHighlightRequested,
  hydrateAnnotationsRequested,
} from "~/lib/themis/annotations/annotations-slice";

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
  const store = useAppStore();
  const highlights = store.annotationsSelectors.selectHighlightsByBook.useValue(bookId);
  const highlightSyncVersion = useSyncListener(["highlight"]);

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

  const reconcileHighlights = useCallback(
    (rendition: SuccessorRenditionAdapter, nextHighlights: Highlight[]) => {
      const nextByCfi = new Map<string, Highlight>();
      for (const highlight of nextHighlights) {
        const previous = highlightsRef.current.get(highlight.cfiRange);
        if (previous && previous.id !== highlight.id) rendition.removeDecoration(previous.id);
        nextByCfi.set(highlight.cfiRange, highlight);
        applyHighlightToRendition(rendition, highlight);
      }
      for (const [cfiRange, highlight] of highlightsRef.current) {
        if (!nextByCfi.has(cfiRange)) rendition.removeDecoration(highlight.id);
      }
      highlightsRef.current = nextByCfi;
    },
    [applyHighlightToRendition],
  );

  useEffect(() => {
    store.dispatch(hydrateAnnotationsRequested(bookId));
  }, [bookId, highlightSyncVersion, store]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) reconcileHighlights(rendition, highlights);
  }, [highlights, reconcileHighlights, renditionRef]);

  /** Apply the current annotations collection after the rendition becomes ready. */
  const loadAndApplyHighlights = useCallback(
    async (rendition: SuccessorRenditionAdapter) => {
      reconcileHighlights(rendition, highlights);
    },
    [highlights, reconcileHighlights],
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

    const saved = await new Promise<Highlight | null>((resolve) => {
      store.dispatch(
        addHighlightRequested(highlight, resolve, (error) => {
          console.error("Failed to save highlight:", error);
          resolve(null);
        }),
      );
    });
    if (!saved) return null;

    setSelectionPopover(null);

    // Clear the selection in the iframe
    rendition.getContents().forEach((content) => {
      const win = content.document?.defaultView;
      if (win) win.getSelection()?.removeAllRanges();
    });

    return saved;
  }, [selectionPopover, theme, bookId, renditionRef, store]);

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
