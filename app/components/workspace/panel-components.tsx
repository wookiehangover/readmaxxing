import { useCallback } from "react";
import type { IDockviewPanelProps } from "dockview";
import {
  WorkspaceBookReader,
  type PanelTypographyParams,
} from "~/components/workspace-book-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";
import { ChatPanel as ChatPanelComponent } from "~/components/chat/chat-panel";
import { useWorkspace } from "~/lib/workspace-context";

export function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<{ bookId: string; bookTitle?: string } & PanelTypographyParams>) {
  // Extract per-panel typography overrides from dockview params (restored layout)
  const panelTypography: PanelTypographyParams = {
    fontFamily: typeof params.fontFamily === "string" ? params.fontFamily : undefined,
    fontSize: typeof params.fontSize === "number" ? params.fontSize : undefined,
    lineHeight: typeof params.lineHeight === "number" ? params.lineHeight : undefined,
    readerLayout:
      typeof params.readerLayout === "string"
        ? (params.readerLayout as PanelTypographyParams["readerLayout"])
        : undefined,
  };

  return (
    <WorkspaceBookReader bookId={params.bookId} panelApi={api} panelTypography={panelTypography} />
  );
}

export function NotebookPanel({
  params,
}: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  const { findNavForBook, notebookCallbackMap } = useWorkspace();

  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      findNavForBook(params.bookId)?.(cfi);
    },
    [findNavForBook, params.bookId],
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

  return (
    <WorkspaceNotebook
      bookId={params.bookId}
      bookTitle={params.bookTitle}
      onNavigateToCfi={handleNavigateToCfi}
      onRegisterAppendHighlight={handleRegisterAppendHighlight}
      onUnregisterAppendHighlight={handleUnregisterAppendHighlight}
    />
  );
}

export function ChatPanel({ params }: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  return <ChatPanelComponent bookId={params.bookId} bookTitle={params.bookTitle} />;
}
