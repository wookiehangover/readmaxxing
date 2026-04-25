import { useCallback } from "react";
import { Effect } from "effect";
import type { AddPanelPositionOptions, DockviewApi } from "dockview";
import type { FocusedCluster } from "~/hooks/use-focused-mode";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import type { BookMeta } from "~/lib/stores/book-store";
import type { LayoutMode, Settings } from "~/lib/settings";
import { truncateTitle } from "~/lib/workspace-utils";
import type { useWorkspace } from "~/lib/context/workspace-context";

const SIDEBAR_TRANSITION_MS = 270;

type WorkspaceContext = ReturnType<typeof useWorkspace>;

export interface UseWorkspacePanelsParams {
  readonly apiRef: React.MutableRefObject<DockviewApi | null>;
  readonly ws: WorkspaceContext;
  readonly isMobileRef: React.MutableRefObject<boolean | undefined>;
  readonly collapsedRef: React.MutableRefObject<boolean>;
  readonly layoutModeRef: React.MutableRefObject<LayoutMode>;
  readonly focusedClustersRef: React.MutableRefObject<Map<string, FocusedCluster>>;
  readonly focusedOrderRef: React.MutableRefObject<string[]>;
  readonly updateSettings: (patch: Partial<Settings>) => void;
}

export interface UseWorkspacePanelsResult {
  readonly openBook: (book: BookMeta) => void;
  readonly openNotebook: (book: BookMeta) => void;
  readonly openChat: (book: BookMeta) => void;
  readonly openStandardEbooks: () => void;
  readonly closeBookPanels: (bookId: string) => void;
}

function findBookPanel(api: DockviewApi, bookId: string) {
  return api.panels.find(
    (p) => p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === bookId,
  );
}

function findRightGroupPosition(
  api: DockviewApi,
  bookId: string,
): AddPanelPositionOptions | undefined {
  const bookPanel = findBookPanel(api, bookId);
  if (!bookPanel) return undefined;
  const bookGroup = bookPanel.group;
  const bookRect = bookGroup.element.getBoundingClientRect();
  const rightGroup = api.groups.find(
    (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
  );
  if (rightGroup) return { referenceGroup: rightGroup };
  return { referencePanel: bookPanel.id, direction: "right" as const };
}

export function useWorkspacePanels({
  apiRef,
  ws,
  isMobileRef,
  collapsedRef,
  layoutModeRef,
  focusedClustersRef,
  focusedOrderRef,
  updateSettings,
}: UseWorkspacePanelsParams): UseWorkspacePanelsResult {
  const addBookPanel = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;
      const panelId = `book-${book.id}`;
      if (api.panels.some((p) => p.id === panelId)) return;
      api.addPanel({
        id: panelId,
        component: "book-reader",
        title: truncateTitle(book.title),
        params: { bookId: book.id, bookTitle: book.title, bookFormat: book.format },
        renderer: "always",
      });
    },
    [apiRef],
  );

  const openBook = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;

      AppRuntime.runPromise(
        WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened(book.id, Date.now()))),
      ).catch(console.error);

      const mode = layoutModeRef.current;
      const isFirstCluster =
        mode === "focused"
          ? focusedClustersRef.current.size === 0
          : !api.panels.some((p) => p.id.startsWith("book-"));

      if (mode === "focused") {
        if (!focusedClustersRef.current.has(book.id)) {
          focusedClustersRef.current.set(book.id, {
            bookId: book.id,
            bookTitle: book.title,
            bookFormat: book.format,
            hasChat: !isMobileRef.current,
            hasNotebook: false,
            activeTab: isMobileRef.current ? "book" : "chat",
          });
          focusedOrderRef.current = [...focusedOrderRef.current, book.id];
        }
        ws.setActiveCluster(book.id);
      } else {
        const existing = findBookPanel(api, book.id);
        if (existing) {
          existing.focus();
          return;
        }
        addBookPanel(book);
        if (isFirstCluster && !isMobileRef.current && window.innerWidth > 1000) {
          api.addPanel({
            id: `chat-${book.id}`,
            component: "chat",
            title: truncateTitle(`Discuss: ${book.title}`),
            params: { bookId: book.id, bookTitle: book.title },
            renderer: "always",
            position: { referencePanel: `book-${book.id}`, direction: "right" },
          });
        }
      }

      if (isFirstCluster && !isMobileRef.current && !collapsedRef.current) {
        updateSettings({ sidebarCollapsed: true });
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, SIDEBAR_TRANSITION_MS);
      }
    },
    [
      addBookPanel,
      apiRef,
      collapsedRef,
      focusedClustersRef,
      focusedOrderRef,
      isMobileRef,
      layoutModeRef,
      updateSettings,
      ws,
    ],
  );

  const openNotebook = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;

      const panelId = `notebook-${book.id}`;
      const mode = layoutModeRef.current;

      if (mode === "focused") {
        let fc = focusedClustersRef.current.get(book.id);
        if (!fc) {
          fc = {
            bookId: book.id,
            bookTitle: book.title,
            bookFormat: book.format,
            hasChat: !isMobileRef.current,
            hasNotebook: true,
            activeTab: "notebook",
          };
          focusedClustersRef.current.set(book.id, fc);
          focusedOrderRef.current = [...focusedOrderRef.current, book.id];
          ws.setActiveCluster(book.id);
          return;
        }
        fc.hasNotebook = true;
        fc.activeTab = "notebook";
        if (ws.activeClusterBookIdRef.current !== book.id) {
          ws.setActiveCluster(book.id);
          return;
        }
        const existing = api.panels.find((p) => p.id === panelId);
        if (existing) {
          existing.focus();
          return;
        }
        const bookPanel = api.panels.find((p) => p.id === `book-${book.id}`);
        const chatPanel = api.panels.find((p) => p.id === `chat-${book.id}`);
        const rightSplit = !isMobileRef.current;
        const position: AddPanelPositionOptions | undefined = rightSplit
          ? chatPanel
            ? { referenceGroup: chatPanel.group }
            : bookPanel
              ? { referencePanel: bookPanel.id, direction: "right" as const }
              : undefined
          : undefined;
        api.addPanel({
          id: panelId,
          component: "notebook",
          title: truncateTitle(`Notes: ${book.title}`),
          params: { bookId: book.id, bookTitle: book.title },
          renderer: "always",
          ...(position ? { position } : {}),
        });
        return;
      }

      const existing = api.panels.find((p) => p.id === panelId);
      if (existing) {
        existing.focus();
        return;
      }
      const position = !isMobileRef.current ? findRightGroupPosition(api, book.id) : undefined;
      api.addPanel({
        id: panelId,
        component: "notebook",
        title: truncateTitle(`Notes: ${book.title}`),
        params: { bookId: book.id, bookTitle: book.title },
        renderer: "always",
        ...(position ? { position } : {}),
      });
    },
    [apiRef, focusedClustersRef, focusedOrderRef, isMobileRef, layoutModeRef, ws],
  );

  const openChat = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;

      const panelId = `chat-${book.id}`;
      const mode = layoutModeRef.current;

      if (mode === "focused") {
        let fc = focusedClustersRef.current.get(book.id);
        if (!fc) {
          fc = {
            bookId: book.id,
            bookTitle: book.title,
            bookFormat: book.format,
            hasChat: true,
            hasNotebook: false,
            activeTab: "chat",
          };
          focusedClustersRef.current.set(book.id, fc);
          focusedOrderRef.current = [...focusedOrderRef.current, book.id];
          ws.setActiveCluster(book.id);
          return;
        }
        fc.hasChat = true;
        fc.activeTab = "chat";
        if (ws.activeClusterBookIdRef.current !== book.id) {
          ws.setActiveCluster(book.id);
          return;
        }
        const existing = api.panels.find((p) => p.id === panelId);
        if (existing) {
          existing.focus();
          return;
        }
        const bookPanel = api.panels.find((p) => p.id === `book-${book.id}`);
        const notebookPanel = api.panels.find((p) => p.id === `notebook-${book.id}`);
        const rightSplit = !isMobileRef.current;
        const position: AddPanelPositionOptions | undefined = rightSplit
          ? notebookPanel
            ? { referenceGroup: notebookPanel.group }
            : bookPanel
              ? { referencePanel: bookPanel.id, direction: "right" as const }
              : undefined
          : undefined;
        api.addPanel({
          id: panelId,
          component: "chat",
          title: truncateTitle(`Discuss: ${book.title}`),
          params: { bookId: book.id, bookTitle: book.title },
          renderer: "always",
          ...(position ? { position } : {}),
        });
        return;
      }

      const existing = api.panels.find((p) => p.id === panelId);
      if (existing) {
        existing.focus();
        return;
      }
      const position = !isMobileRef.current ? findRightGroupPosition(api, book.id) : undefined;
      api.addPanel({
        id: panelId,
        component: "chat",
        title: truncateTitle(`Discuss: ${book.title}`),
        params: { bookId: book.id, bookTitle: book.title },
        renderer: "always",
        ...(position ? { position } : {}),
      });
    },
    [apiRef, focusedClustersRef, focusedOrderRef, isMobileRef, layoutModeRef, ws],
  );

  const openStandardEbooks = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.id.startsWith("standard-ebooks-"));
    if (existing) {
      existing.focus();
      return;
    }
    api.addPanel({
      id: `standard-ebooks-${crypto.randomUUID().slice(0, 8)}`,
      component: "standard-ebooks",
      title: "Standard Ebooks",
      params: {},
    });
  }, [apiRef]);

  const closeBookPanels = useCallback(
    (bookId: string) => {
      const api = apiRef.current;
      if (api) {
        for (const panel of api.panels.filter(
          (p) => (p.params as Record<string, unknown> | undefined)?.bookId === bookId,
        )) {
          api.removePanel(panel);
        }
      }

      const wasTracked = focusedClustersRef.current.delete(bookId);
      const nextOrder = focusedOrderRef.current.filter((id) => id !== bookId);
      focusedOrderRef.current = nextOrder;
      if (ws.activeClusterBookIdRef.current === bookId) {
        ws.activeClusterBookIdRef.current = nextOrder[nextOrder.length - 1] ?? null;
      }
      if (wasTracked) ws.notifyClusterChanges();
    },
    [apiRef, focusedClustersRef, focusedOrderRef, ws],
  );

  return { openBook, openNotebook, openChat, openStandardEbooks, closeBookPanels };
}
