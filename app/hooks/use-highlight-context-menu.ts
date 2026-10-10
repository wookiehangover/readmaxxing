import { useCallback, useState } from "react";
import type { Highlight } from "~/lib/stores/annotations-store";
import { useAppStore } from "~/lib/themis/provider";
import { deleteHighlightRequested } from "~/lib/themis/annotations/annotations-slice";

export interface HighlightContextMenuState {
  highlight: Highlight;
  position: { x: number; y: number };
}

/** State and delete action for the right-click menu on a rendered highlight. */
export function useHighlightContextMenu(bookId: string) {
  const store = useAppStore();
  const [highlightMenu, setHighlightMenu] = useState<HighlightContextMenuState | null>(null);

  const openHighlightMenu = useCallback(
    (highlight: Highlight, position: { x: number; y: number }) => {
      setHighlightMenu({ highlight, position });
    },
    [],
  );

  const dismissHighlightMenu = useCallback(() => setHighlightMenu(null), []);

  const deleteMenuHighlight = useCallback(() => {
    if (!highlightMenu) return;
    setHighlightMenu(null);
    store.dispatch(
      deleteHighlightRequested(bookId, highlightMenu.highlight.id, undefined, (error) =>
        console.error("Failed to delete highlight:", error),
      ),
    );
  }, [bookId, highlightMenu, store]);

  return { highlightMenu, openHighlightMenu, dismissHighlightMenu, deleteMenuHighlight };
}
