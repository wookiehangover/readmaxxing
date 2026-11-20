import { useCallback, useState } from "react";
import type { Highlight } from "~/lib/stores/annotations-store";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { deleteHighlightRequested } from "~/lib/themis/annotations/annotations-slice";

export interface HighlightContextMenuState {
  highlight: Highlight;
  position: { x: number; y: number };
}

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
