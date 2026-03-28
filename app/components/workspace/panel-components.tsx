import { useCallback } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { TocEntry } from "~/lib/reader-context";
import {
  WorkspaceBookReader,
  type PanelTypographyParams,
} from "~/components/workspace-book-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";
import { ChatPanel as ChatPanelComponent } from "~/components/chat-panel";
import { truncateTitle } from "~/lib/workspace-utils";
import { useWorkspace } from "~/lib/workspace-context";
import { useIsMobile } from "~/hooks/use-mobile";

export function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<{ bookId: string; bookTitle?: string } & PanelTypographyParams>) {
  const {
    navigationMap,
    tocMap,
    tocChangeListener,
    dockviewApi,
    notebookCallbackMap,
    chatContextMap,
    tempHighlightMap,
  } = useWorkspace();

  const handleRegister = useCallback(
    (panelId: string, nav: (cfi: string) => void) => {
      console.debug("[BookReaderPanel] handleRegister", { panelId });
      navigationMap.current.set(panelId, nav);
    },
    [navigationMap],
  );

  const handleUnregister = useCallback(
    (panelId: string) => {
      navigationMap.current.delete(panelId);
    },
    [navigationMap],
  );

  const handleRegisterToc = useCallback(
    (panelId: string, toc: TocEntry[]) => {
      tocMap.current.set(panelId, toc);
      tocChangeListener.current?.();
    },
    [tocMap, tocChangeListener],
  );

  const handleUnregisterToc = useCallback(
    (panelId: string) => {
      tocMap.current.delete(panelId);
      tocChangeListener.current?.();
    },
    [tocMap, tocChangeListener],
  );

  const isMobile = useIsMobile();

  const handleOpenNotebook = useCallback(() => {
    const dockApi = dockviewApi.current;
    if (!dockApi) return;

    const panelId = `notebook-${params.bookId}`;
    const existing = dockApi.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    const title = params.bookTitle ?? "Untitled";

    // On mobile, open as a tab in the same group (no split)
    if (isMobile) {
      dockApi.addPanel({
        id: panelId,
        component: "notebook",
        title: truncateTitle(`Notes: ${title}`),
        params: { bookId: params.bookId, bookTitle: title },
        renderer: "always",
      });
      return;
    }

    // Desktop: reuse an existing group to the right if one exists, otherwise split
    const bookGroup = api.group;
    const bookRect = bookGroup.element.getBoundingClientRect();
    const rightGroup = dockApi.groups.find(
      (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
    );

    dockApi.addPanel({
      id: panelId,
      component: "notebook",
      title: truncateTitle(`Notes: ${title}`),
      params: { bookId: params.bookId, bookTitle: title },
      renderer: "always",
      position: rightGroup
        ? { referenceGroup: rightGroup }
        : { referencePanel: api.id, direction: "right" as const },
    });
  }, [dockviewApi, params.bookId, params.bookTitle, api, isMobile]);

  const handleOpenChat = useCallback(() => {
    const dockApi = dockviewApi.current;
    if (!dockApi) return;

    const panelId = `chat-${params.bookId}`;
    const existing = dockApi.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    const title = params.bookTitle ?? "Untitled";

    // On mobile, open as a tab in the same group (no split)
    if (isMobile) {
      dockApi.addPanel({
        id: panelId,
        component: "chat",
        title: truncateTitle(`Chat: ${title}`),
        params: { bookId: params.bookId, bookTitle: title },
        renderer: "always",
      });
      return;
    }

    // Desktop: reuse an existing group to the right if one exists, otherwise split
    const bookGroup = api.group;
    const bookRect = bookGroup.element.getBoundingClientRect();
    const rightGroup = dockApi.groups.find(
      (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
    );

    dockApi.addPanel({
      id: panelId,
      component: "chat",
      title: truncateTitle(`Chat: ${title}`),
      params: { bookId: params.bookId, bookTitle: title },
      renderer: "always",
      position: rightGroup
        ? { referenceGroup: rightGroup }
        : { referencePanel: api.id, direction: "right" as const },
    });
  }, [dockviewApi, params.bookId, params.bookTitle, api, isMobile]);

  const handleHighlightCreated = useCallback(
    (highlight: { highlightId: string; cfiRange: string; text: string }) => {
      const appendFn = notebookCallbackMap.current.get(params.bookId);
      if (appendFn) {
        appendFn(highlight);
      }
    },
    [notebookCallbackMap, params.bookId],
  );

  const handleRegisterTempHighlight = useCallback(
    (panelId: string, fn: (cfi: string) => void) => {
      tempHighlightMap.current.set(panelId, fn);
    },
    [tempHighlightMap],
  );

  const handleUnregisterTempHighlight = useCallback(
    (panelId: string) => {
      tempHighlightMap.current.delete(panelId);
    },
    [tempHighlightMap],
  );

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
    <WorkspaceBookReader
      bookId={params.bookId}
      panelApi={api}
      panelTypography={panelTypography}
      onRegisterNavigation={handleRegister}
      onUnregisterNavigation={handleUnregister}
      onRegisterToc={handleRegisterToc}
      onUnregisterToc={handleUnregisterToc}
      onOpenNotebook={handleOpenNotebook}
      onOpenChat={handleOpenChat}
      onHighlightCreated={handleHighlightCreated}
      chatContextMap={chatContextMap}
      onRegisterTempHighlight={handleRegisterTempHighlight}
      onUnregisterTempHighlight={handleUnregisterTempHighlight}
    />
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
