import { useCallback, useRef, useState } from "react";
import { Effect } from "effect";
import type Rendition from "epubjs/types/rendition";
import { AnnotationService, type Highlight } from "~/lib/annotations-store";
import { AppRuntime } from "~/lib/effect-runtime";

export interface SelectionPopover {
  position: { x: number; y: number };
  cfiRange: string;
  text: string;
}

export interface EditPopover {
  position: { x: number; y: number };
  highlight: Highlight;
}

interface UseHighlightsOptions {
  bookId: string;
  renditionRef: React.RefObject<Rendition | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Computes popover position from a highlight click event,
 * handling both parent-window and iframe coordinate spaces.
 */
function computeClickPosition(
  e: MouseEvent,
  containerRef: React.RefObject<HTMLDivElement | null>,
): { x: number; y: number } | null {
  const target = e.target as Element;
  const targetRect = target.getBoundingClientRect();
  const isParentContext = e.view === window;

  if (targetRect.width > 0 && targetRect.height > 0) {
    if (isParentContext) {
      return {
        x: targetRect.left + targetRect.width / 2,
        y: targetRect.bottom,
      };
    }
    const iframe = containerRef.current?.querySelector("iframe");
    if (!iframe) return null;
    const iframeRect = iframe.getBoundingClientRect();
    return {
      x: iframeRect.left + targetRect.left + targetRect.width / 2,
      y: iframeRect.top + targetRect.bottom,
    };
  }

  // Fallback to mouse coordinates
  const iframe = containerRef.current?.querySelector("iframe");
  if (!iframe) return null;
  const iframeRect = iframe.getBoundingClientRect();
  if (isParentContext) {
    return { x: e.clientX, y: e.clientY };
  }
  return {
    x: iframeRect.left + e.clientX,
    y: iframeRect.top + e.clientY,
  };
}

export function useHighlights({ bookId, renditionRef, containerRef }: UseHighlightsOptions) {
  const highlightsRef = useRef<Map<string, Highlight>>(new Map());
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopover | null>(null);
  const [editPopover, setEditPopover] = useState<EditPopover | null>(null);

  const makeClickCallback = useCallback(
    (cfiRange: string) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const stored = highlightsRef.current.get(cfiRange);
      if (!stored) return;
      const pos = computeClickPosition(e, containerRef);
      if (!pos) return;
      setEditPopover({ position: pos, highlight: stored });
      setSelectionPopover(null);
    },
    [containerRef],
  );

  /** Apply a single highlight to the rendition with a click callback. */
  const applyHighlightToRendition = useCallback(
    (rendition: Rendition, hl: Highlight) => {
      rendition.annotations.highlight(
        hl.cfiRange,
        {},
        makeClickCallback(hl.cfiRange),
        "epubjs-hl",
        { fill: hl.color || "rgba(255, 213, 79, 0.4)" },
      );
    },
    [makeClickCallback],
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
    const color = "rgba(255, 213, 79, 0.4)";

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

  /** Delete a highlight from IndexedDB and remove the annotation from the rendition. */
  const deleteHighlightFromPopover = useCallback(async () => {
    const rendition = renditionRef.current;
    if (!editPopover || !rendition) return;
    const { highlight } = editPopover;

    const deleteProgram = Effect.gen(function* () {
      const svc = yield* AnnotationService;
      yield* svc.deleteHighlight(highlight.id);
    });
    await AppRuntime.runPromise(deleteProgram).catch(console.error);
    rendition.annotations.remove(highlight.cfiRange, "highlight");
    highlightsRef.current.delete(highlight.cfiRange);
    setEditPopover(null);
  }, [editPopover, renditionRef]);

  const dismissPopovers = useCallback(() => {
    setSelectionPopover(null);
    setEditPopover(null);
  }, []);

  return {
    selectionPopover,
    editPopover,
    saveHighlight,
    deleteHighlightFromPopover,
    dismissPopovers,
    loadAndApplyHighlights,
    registerSelectionHandler,
  };
}
