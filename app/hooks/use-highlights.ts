import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import type Rendition from "epubjs/types/rendition";
import { AnnotationService, type Highlight } from "~/lib/stores/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { type Theme, resolveTheme } from "~/lib/settings";

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
  renditionRef: React.RefObject<Rendition | null>;
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

  const makeClickCallback = useCallback(
    (cfiRange: string) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stored = highlightsRef.current.get(cfiRange);
      if (!stored) return;
      setSelectionPopover(null);
      onHighlightClickRef.current?.(stored);
    },
    [],
  );

  /** Apply a single highlight to the rendition with a click callback. */
  const applyHighlightToRendition = useCallback(
    (rendition: Rendition, hl: Highlight) => {
      const fillColor = getHighlightColor(theme);
      rendition.annotations.highlight(
        hl.cfiRange,
        {},
        makeClickCallback(hl.cfiRange),
        "epubjs-hl",
        { fill: fillColor },
      );
    },
    [makeClickCallback, theme],
  );

  /** Load all highlights for the book from IndexedDB and apply them to the rendition. */
  const loadAndApplyHighlights = useCallback(
    async (rendition: Rendition) => {
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

  /** Register the selection handler on a rendition. */
  const registerSelectionHandler = useCallback((rendition: Rendition) => {
    rendition.on("selected", (cfiRange: string, contents: any) => {
      const range = contents.range(cfiRange);
      const text = range?.toString() || "";
      if (!text.trim()) return;

      const iframe = contents.document?.defaultView?.frameElement;
      if (!iframe) return;
      const iframeRect = iframe.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();

      const x = iframeRect.left + rangeRect.left + rangeRect.width / 2;
      const y = iframeRect.top + rangeRect.bottom;

      setSelectionPopover({ position: { x, y }, cfiRange, text });
    });
  }, []);

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
    const contents = (rendition as any).getContents() as any[];
    contents.forEach((content: any) => {
      const win = content.document?.defaultView;
      if (win) win.getSelection()?.removeAllRanges();
    });

    return highlight;
  }, [selectionPopover, bookId, renditionRef, applyHighlightToRendition]);

  const dismissPopovers = useCallback(() => {
    setSelectionPopover(null);
  }, []);

  return {
    selectionPopover,
    saveHighlight,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
    highlightsRef,
  };
}
