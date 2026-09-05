import { useCallback } from "react";
import { WorkspaceNotebook } from "~/components/workspace-notebook";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { deleteHighlightRequested } from "~/lib/themis/annotations/annotations-slice";

export function WorkspaceNotebookPanel({
  bookId,
  bookTitle,
  chromeless = false,
}: {
  bookId: string;
  bookTitle: string;
  chromeless?: boolean;
}) {
  const { navigateInCluster, notebookCallbackMap, removeHighlightAnnotationForBook } =
    useWorkspace();
  const store = useAppStore();

  const handleNavigateToCfi = useCallback(
    async (cfi: string) => {
      await navigateInCluster(bookId, cfi);
    },
    [bookId, navigateInCluster],
  );

  const handleRegisterAppendHighlight = useCallback(
    (
      bookId: string,
      fn: (attrs: { highlightId: string; cfiRange: string; text: string }) => void,
    ) => {
      notebookCallbackMap.current.set(bookId, fn);
    },
    [notebookCallbackMap],
  );

  const handleUnregisterAppendHighlight = useCallback(
    (
      bookId: string,
      fn: (attrs: { highlightId: string; cfiRange: string; text: string }) => void,
    ) => {
      if (notebookCallbackMap.current.get(bookId) === fn) {
        notebookCallbackMap.current.delete(bookId);
      }
    },
    [notebookCallbackMap],
  );

  const handleDeleteHighlight = useCallback(
    (highlightId: string, cfiRange: string) => {
      store.dispatch(
        deleteHighlightRequested(
          bookId,
          highlightId,
          () => removeHighlightAnnotationForBook(bookId, cfiRange),
          (error) => console.error("Failed to delete highlight:", error),
        ),
      );
    },
    [bookId, removeHighlightAnnotationForBook, store],
  );

  return (
    <WorkspaceNotebook
      key={bookId}
      bookId={bookId}
      bookTitle={bookTitle}
      chromeless={chromeless}
      onNavigateToCfi={handleNavigateToCfi}
      onDeleteHighlight={handleDeleteHighlight}
      onRegisterAppendHighlight={handleRegisterAppendHighlight}
      onUnregisterAppendHighlight={handleUnregisterAppendHighlight}
    />
  );
}
