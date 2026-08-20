import { useCallback } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import {
  WorkspaceBookReader,
  type PanelTypographyParams,
} from "~/components/workspace-book-reader";
import { WorkspacePdfReader } from "~/components/workspace-pdf-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";
import { ChatPanel as ChatPanelComponent } from "~/components/chat/chat-panel";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useAppStore } from "~/lib/themis/provider";
import { deleteHighlightRequested } from "~/lib/themis/annotations/annotations-slice";

export function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<
  { bookId: string; bookTitle?: string; bookFormat?: string } & PanelTypographyParams
>) {
  // Extract per-panel typography overrides from dockview params (restored layout)
  const panelTypography: PanelTypographyParams = {
    fontFamily: typeof params.fontFamily === "string" ? params.fontFamily : undefined,
    fontSize: typeof params.fontSize === "number" ? params.fontSize : undefined,
    lineHeight: typeof params.lineHeight === "number" ? params.lineHeight : undefined,
    textAlign:
      typeof params.textAlign === "string"
        ? (params.textAlign as PanelTypographyParams["textAlign"])
        : undefined,
    readerLayout:
      typeof params.readerLayout === "string"
        ? (params.readerLayout as PanelTypographyParams["readerLayout"])
        : undefined,
  };

  // PDF books use the dedicated PDF reader component
  if (params.bookFormat === "pdf") {
    return (
      <WorkspacePdfReader bookId={params.bookId} panelApi={api} panelTypography={panelTypography} />
    );
  }

  return (
    <WorkspaceBookReader bookId={params.bookId} panelApi={api} panelTypography={panelTypography} />
  );
}

export function NotebookPanel({
  params,
}: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  return <WorkspaceNotebookPanel bookId={params.bookId} bookTitle={params.bookTitle} />;
}

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
    (bookId: string) => {
      notebookCallbackMap.current.delete(bookId);
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

export function ChatPanel({ params }: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  return <ChatPanelComponent bookId={params.bookId} bookTitle={params.bookTitle} />;
}
