import { useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { DockviewApi, DockviewReadyEvent } from "dockview-react";
import type { FocusedCluster } from "~/hooks/use-focused-mode";
import { AppRuntime } from "~/lib/effect-runtime";
import { clampFocusedSplitRatio, type Settings } from "~/lib/settings";
import { WorkspaceService, type FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import type { BookMeta } from "~/lib/stores/book-store";
import type { useWorkspace } from "~/lib/context/workspace-context";

const LAYOUT_SAVE_DEBOUNCE_MS = 500;
const FOCUSED_STATE_SAVE_DEBOUNCE_MS = 300;
const FOCUSED_RATIO_SAVE_DEBOUNCE_MS = 300;
const FOCUSED_RATIO_EPSILON = 0.005;
const FOCUSED_BOOK_GROUP_CLASS = "dv-focused-book-group";

type WorkspaceContext = ReturnType<typeof useWorkspace>;

export function consumePendingClusterActivation(
  pendingBookIdRef: React.MutableRefObject<string | null>,
  activeBookIdRef: React.MutableRefObject<string | null>,
  focusedClusters: ReadonlyMap<string, unknown>,
): void {
  const pendingBookId = pendingBookIdRef.current;
  pendingBookIdRef.current = null;
  if (pendingBookId !== null && focusedClusters.has(pendingBookId)) {
    activeBookIdRef.current = pendingBookId;
  }
}

/**
 * Remove restored panels whose bookId no longer exists. Runs after a
 * successful `fromJSON` restore — mutating the serialized layout up front
 * would leave dangling panel ids in the grid/views tree and make dockview
 * revert the entire restore.
 */
function removeOrphanedPanels(api: DockviewApi, existingBookIds: Set<string>): void {
  // Snapshot before removing — api.panels is recomputed per access.
  const panels = Array.from(api.panels);
  for (const panel of panels) {
    const bookId = (panel.params as Record<string, unknown> | undefined)?.bookId;
    if (typeof bookId === "string" && !existingBookIds.has(bookId)) {
      console.log(`[workspace] Removed orphaned panel ${panel.id} for deleted book ${bookId}`);
      api.removePanel(panel);
    }
  }
}

export interface UseWorkspaceLayoutParams {
  readonly apiRef: React.MutableRefObject<DockviewApi | null>;
  readonly ws: WorkspaceContext;
  readonly books: BookMeta[];
  readonly isMobile: boolean | undefined;
  readonly isMobileRef: React.MutableRefObject<boolean | undefined>;
  readonly focusedSplitRatioRef: React.MutableRefObject<number>;
  readonly focusedClustersRef: React.MutableRefObject<Map<string, FocusedCluster>>;
  readonly focusedOrderRef: React.MutableRefObject<string[]>;
  readonly swapInProgressRef: React.MutableRefObject<boolean>;
  readonly pendingClusterActivationRef: React.MutableRefObject<string | null>;
  readonly getActiveClusterId: () => string | null;
  readonly enforceSingleFocusedCluster: () => void;
  readonly updateSettings: (patch: Partial<Settings>) => void;
  readonly setOpenBookIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseWorkspaceLayoutResult {
  readonly layoutReady: boolean;
  readonly onReady: (event: DockviewReadyEvent) => void;
  readonly onDispose: () => void;
}

export function useWorkspaceLayout({
  apiRef,
  ws,
  books,
  isMobile,
  isMobileRef,
  focusedSplitRatioRef,
  focusedClustersRef,
  focusedOrderRef,
  swapInProgressRef,
  pendingClusterActivationRef,
  getActiveClusterId,
  enforceSingleFocusedCluster,
  updateSettings,
  setOpenBookIds,
}: UseWorkspaceLayoutParams): UseWorkspaceLayoutResult {
  const [layoutReady, setLayoutReady] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRatioSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  const restoreTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const flushFocusedStateRef = useRef<() => void>(() => {});
  // `onReady` intentionally omits `books` from its deps; read the current book
  // ids through a ref to avoid stale closures.
  const existingBookIdsRef = useRef(new Set<string>());
  existingBookIdsRef.current = new Set(books.map((b) => b.id));

  const serializeFocusedState = useCallback((): FocusedWorkspaceState => {
    const order = focusedOrderRef.current.filter((bookId) =>
      focusedClustersRef.current.has(bookId),
    );
    return {
      order,
      activeBookId: ws.activeClusterBookIdRef.current,
      clusters: order.map((bookId) => focusedClustersRef.current.get(bookId)!),
    };
  }, [focusedClustersRef, focusedOrderRef, ws]);

  const flushFocusedState = useCallback(() => {
    if (!mountedRef.current) return;
    AppRuntime.runPromise(
      WorkspaceService.pipe(Effect.andThen((s) => s.saveFocusedState(serializeFocusedState()))),
    ).catch(console.error);
  }, [serializeFocusedState]);

  const saveFocusedState = useCallback(() => {
    if (focusedStateSaveTimerRef.current) clearTimeout(focusedStateSaveTimerRef.current);
    focusedStateSaveTimerRef.current = setTimeout(() => {
      focusedStateSaveTimerRef.current = null;
      flushFocusedState();
    }, FOCUSED_STATE_SAVE_DEBOUNCE_MS);
  }, [flushFocusedState]);

  useEffect(() => {
    flushFocusedStateRef.current = flushFocusedState;
  }, [flushFocusedState]);

  const flushLayout = useCallback(() => {
    if (!mountedRef.current) return;
    const api = apiRef.current;
    if (!api) return;
    AppRuntime.runPromise(
      WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(api.toJSON()))),
    ).catch(console.error);
  }, [apiRef]);

  const saveLayout = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushLayout();
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [flushLayout]);

  const captureFocusedRatio = useCallback(() => {
    if (isMobileRef.current) return;
    if (swapInProgressRef.current) return;
    const api = apiRef.current;
    if (!api) return;

    const activeBookId = getActiveClusterId();
    if (!activeBookId) return;
    const cluster = focusedClustersRef.current.get(activeBookId);
    if (!cluster) return;
    const { hasChat, hasNotebook } = cluster;
    if (!hasChat && !hasNotebook) return;

    const bookPanel = api.panels.find((p) => p.id === `book-${activeBookId}`);
    const rightAnchor = api.panels.find(
      (p) => p.id === (hasChat ? `chat-${activeBookId}` : `notebook-${activeBookId}`),
    );
    const bookGroup = bookPanel?.group;
    const rightGroup = rightAnchor?.group;
    if (!bookGroup || !rightGroup || bookGroup === rightGroup) return;

    const total = bookGroup.api.width + rightGroup.api.width;
    if (total <= 0) return;
    const nextRatio = clampFocusedSplitRatio(bookGroup.api.width / total);
    if (Math.abs(nextRatio - focusedSplitRatioRef.current) < FOCUSED_RATIO_EPSILON) return;

    if (focusedRatioSaveTimerRef.current) clearTimeout(focusedRatioSaveTimerRef.current);
    focusedRatioSaveTimerRef.current = setTimeout(() => {
      focusedRatioSaveTimerRef.current = null;
      if (!mountedRef.current) return;
      if (Math.abs(nextRatio - focusedSplitRatioRef.current) < FOCUSED_RATIO_EPSILON) return;
      updateSettings({ focusedSplitRatio: nextRatio });
    }, FOCUSED_RATIO_SAVE_DEBOUNCE_MS);
  }, [
    apiRef,
    focusedClustersRef,
    focusedSplitRatioRef,
    getActiveClusterId,
    isMobileRef,
    swapInProgressRef,
    updateSettings,
  ]);

  const updateFocusedBookGroupChrome = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    for (const group of api.groups) {
      const isFocusedBookGroup =
        !isMobileRef.current &&
        group.panels.length === 1 &&
        (group.panels[0]?.id.startsWith("book-") || group.panels[0]?.id === "new-tab");
      group.element.classList.toggle(FOCUSED_BOOK_GROUP_CLASS, isFocusedBookGroup);
    }
  }, [apiRef, isMobileRef]);

  const onDispose = useCallback(() => {
    restoreTokenRef.current += 1;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      flushLayout();
    }
    if (focusedStateSaveTimerRef.current) {
      clearTimeout(focusedStateSaveTimerRef.current);
      focusedStateSaveTimerRef.current = null;
      flushFocusedState();
    }
    if (focusedRatioSaveTimerRef.current) {
      clearTimeout(focusedRatioSaveTimerRef.current);
      focusedRatioSaveTimerRef.current = null;
    }
    for (const disposable of disposablesRef.current) disposable.dispose();
    disposablesRef.current = [];
    apiRef.current = null;
    ws.dockviewApi.current = null;
    setLayoutReady(false);
  }, [apiRef, flushFocusedState, flushLayout, ws]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      onDispose();
      apiRef.current = event.api;
      ws.dockviewApi.current = event.api;

      const restoreToken = ++restoreTokenRef.current;
      AppRuntime.runPromise(
        WorkspaceService.pipe(
          Effect.andThen((s) => s.getLayout()),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      )
        .then((layout) => {
          if (!mountedRef.current || restoreToken !== restoreTokenRef.current) {
            return;
          }
          const hasFocusedRestore = focusedOrderRef.current.length > 0;
          if (layout && !hasFocusedRestore) {
            try {
              event.api.fromJSON(layout);
              removeOrphanedPanels(event.api, existingBookIdsRef.current);
            } catch (err) {
              console.error("Failed to restore dockview layout:", err);
            }
          }
          consumePendingClusterActivation(
            pendingClusterActivationRef,
            ws.activeClusterBookIdRef,
            focusedClustersRef.current,
          );
          enforceSingleFocusedCluster();
          updateFocusedBookGroupChrome();
          setLayoutReady(true);
        })
        .catch((err) => {
          if (!mountedRef.current || restoreToken !== restoreTokenRef.current) return;
          console.error(err);
          updateFocusedBookGroupChrome();
          setLayoutReady(true);
        });

      const updateOpenBooks = () => {
        const ids = new Set<string>();
        for (const panel of event.api.panels) {
          if (panel.id.startsWith("book-")) {
            const bookId = (panel.params as Record<string, unknown>)?.bookId;
            if (typeof bookId === "string") ids.add(bookId);
          }
        }
        setOpenBookIds(ids);
      };
      updateOpenBooks();

      const rebuildClusters = () => {
        type MutableCluster = {
          bookPanelId?: string;
          chatPanelId?: string;
          notebookPanelId?: string;
        };
        const accum = new Map<string, MutableCluster>();
        for (const panel of event.api.panels) {
          const bookId = (panel.params as Record<string, unknown>)?.bookId;
          if (typeof bookId !== "string") continue;
          const entry = accum.get(bookId) ?? {};
          if (panel.id.startsWith("book-")) entry.bookPanelId = panel.id;
          else if (panel.id.startsWith("chat-")) entry.chatPanelId = panel.id;
          else if (panel.id.startsWith("notebook-")) entry.notebookPanelId = panel.id;
          accum.set(bookId, entry);
        }
        const next = new Map<
          string,
          { bookPanelId: string; chatPanelId?: string; notebookPanelId?: string }
        >();
        for (const [bookId, entry] of accum) {
          if (!entry.bookPanelId) continue;
          next.set(bookId, {
            bookPanelId: entry.bookPanelId,
            chatPanelId: entry.chatPanelId,
            notebookPanelId: entry.notebookPanelId,
          });
        }
        ws.clustersRef.current = next;
        for (const [bookId, fc] of focusedClustersRef.current) {
          const entry = next.get(bookId);
          if (!entry) continue;
          fc.hasChat = entry.chatPanelId !== undefined;
          fc.hasNotebook = entry.notebookPanelId !== undefined;
        }
        if (!swapInProgressRef.current) {
          const activeId = ws.activeClusterBookIdRef.current;
          if (activeId && !next.has(activeId)) {
            ws.activeClusterBookIdRef.current = null;
          }
        }
        ws.notifyClusterChanges();
      };
      rebuildClusters();

      const updateActiveCluster = (panel: { params?: unknown } | undefined) => {
        if (!panel) return;
        if (swapInProgressRef.current) return;
        const bookId = (panel.params as Record<string, unknown>)?.bookId;
        if (typeof bookId !== "string") return;
        if (!ws.clustersRef.current.has(bookId)) return;
        const fc = focusedClustersRef.current.get(bookId);
        let activeTabChanged = false;
        if (fc) {
          const id = (panel as { id?: string }).id;
          const activeTab = id?.startsWith("chat-")
            ? "chat"
            : id?.startsWith("notebook-")
              ? "notebook"
              : id?.startsWith("book-")
                ? "book"
                : fc.activeTab;
          activeTabChanged = fc.activeTab !== activeTab;
          fc.activeTab = activeTab;
        }
        if (ws.activeClusterBookIdRef.current === bookId) {
          if (activeTabChanged) ws.notifyClusterChanges();
          return;
        }
        ws.activeClusterBookIdRef.current = bookId;
        ws.notifyClusterChanges();
      };

      disposablesRef.current = [
        event.api.onDidAddPanel(updateOpenBooks),
        event.api.onDidRemovePanel(updateOpenBooks),
        event.api.onDidAddPanel(rebuildClusters),
        event.api.onDidRemovePanel(rebuildClusters),
        event.api.onDidActivePanelChange(({ panel }) => updateActiveCluster(panel)),
        event.api.onDidAddPanel(saveLayout),
        event.api.onDidRemovePanel(saveLayout),
        event.api.onDidMovePanel(saveLayout),
        event.api.onDidLayoutChange(saveLayout),
        event.api.onDidAddPanel(updateFocusedBookGroupChrome),
        event.api.onDidRemovePanel(updateFocusedBookGroupChrome),
        event.api.onDidMovePanel(updateFocusedBookGroupChrome),
        event.api.onDidLayoutChange(updateFocusedBookGroupChrome),
        event.api.onDidLayoutChange(captureFocusedRatio),
      ];
    },
    [
      apiRef,
      captureFocusedRatio,
      enforceSingleFocusedCluster,
      focusedClustersRef,
      focusedOrderRef,
      onDispose,
      pendingClusterActivationRef,
      saveLayout,
      setOpenBookIds,
      swapInProgressRef,
      updateFocusedBookGroupChrome,
      ws,
    ],
  );

  useEffect(() => {
    updateFocusedBookGroupChrome();
  }, [isMobile, updateFocusedBookGroupChrome]);

  useEffect(() => {
    return ws.subscribeClusterChanges(saveFocusedState);
  }, [saveFocusedState, ws]);

  useEffect(() => {
    const syncFocusedOpenBooks = () => setOpenBookIds(new Set(focusedOrderRef.current));
    syncFocusedOpenBooks();
    return ws.subscribeClusterChanges(syncFocusedOpenBooks);
  }, [focusedOrderRef, setOpenBookIds, ws]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
      if (focusedStateSaveTimerRef.current) {
        clearTimeout(focusedStateSaveTimerRef.current);
        focusedStateSaveTimerRef.current = null;
        flushFocusedState();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
      if (document.visibilityState === "hidden" && focusedStateSaveTimerRef.current) {
        clearTimeout(focusedStateSaveTimerRef.current);
        focusedStateSaveTimerRef.current = null;
        flushFocusedState();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushFocusedState, flushLayout]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      restoreTokenRef.current += 1;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (focusedStateSaveTimerRef.current) {
        clearTimeout(focusedStateSaveTimerRef.current);
        focusedStateSaveTimerRef.current = null;
        flushFocusedStateRef.current();
      }
      if (focusedRatioSaveTimerRef.current) {
        clearTimeout(focusedRatioSaveTimerRef.current);
        focusedRatioSaveTimerRef.current = null;
      }
      mountedRef.current = false;
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      apiRef.current = null;
      ws.dockviewApi.current = null;
      ws.navigationMap.current.clear();
      ws.tocMap.current.clear();
      ws.notebookCallbackMap.current.clear();
      ws.tempHighlightMap.current.clear();
      ws.clustersRef.current.clear();
      ws.activeClusterBookIdRef.current = null;
    };
  }, [apiRef, ws]);

  return { layoutReady, onReady, onDispose };
}
