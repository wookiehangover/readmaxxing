import { useCallback, useState } from "react";
import type { Highlight } from "~/lib/stores/annotations-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { deleteHighlightRequested } from "~/lib/themis/annotations/annotations-slice";

export interface HighlightContextMenuState {
  highlight: Highlight;
  position: { x: number; y: number };
}

/** State, copy, and delete actions for the right-click menu on a rendered highlight. */
export function useHighlightContextMenu(bookId: string) {
  const store = useAppStore();
  const { notebookEditorCallbackMap } = useWorkspace();
  const [highlightMenu, setHighlightMenu] = useState<HighlightContextMenuState | null>(null);

  const openHighlightMenu = useCallback(
    (highlight: Highlight, position: { x: number; y: number }) => {
      setHighlightMenu({ highlight, position });
    },
    [],
  );

  const dismissHighlightMenu = useCallback(() => setHighlightMenu(null), []);

  const copyMenuHighlight = useCallback(() => {
    if (!highlightMenu) return;
    setHighlightMenu(null);
    navigator.clipboard
      .writeText(highlightMenu.highlight.text)
      .catch((error) => console.error("Failed to copy highlight:", error));
  }, [highlightMenu]);

  const deleteMenuHighlight = useCallback(() => {
    if (!highlightMenu) return;
    setHighlightMenu(null);
    // An open notebook saves on a debounce, so edit it directly or its next save restores the node.
    notebookEditorCallbackMap.current
      .get(bookId)
      ?.removeHighlightReference(highlightMenu.highlight.id);
    store.dispatch(
      deleteHighlightRequested(bookId, highlightMenu.highlight.id, undefined, (error) =>
        console.error("Failed to delete highlight:", error),
      ),
    );
  }, [bookId, highlightMenu, notebookEditorCallbackMap, store]);

  return {
    highlightMenu,
    openHighlightMenu,
    dismissHighlightMenu,
    copyMenuHighlight,
    deleteMenuHighlight,
  };
}
