import { useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { DockviewApi, DockviewReadyEvent } from "dockview";
import type { FocusedCluster } from "~/hooks/use-focused-mode";
import { AppRuntime } from "~/lib/effect-runtime";
import { clampFocusedSplitRatio, type LayoutMode, type Settings } from "~/lib/settings";
import { WorkspaceService, type FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import type { BookMeta } from "~/lib/stores/book-store";
import type { useWorkspace } from "~/lib/context/workspace-context";

const LAYOUT_SAVE_DEBOUNCE_MS = 500;
const FOCUSED_STATE_SAVE_DEBOUNCE_MS = 300;
const FOCUSED_RATIO_SAVE_DEBOUNCE_MS = 300;
const FOCUSED_RATIO_EPSILON = 0.005;
const FOCUSED_BOOK_GROUP_CLASS = "dv-focused-book-group";

type WorkspaceContext = ReturnType<typeof useWorkspace>;

export interface UseWorkspaceLayoutParams {
  readonly apiRef: React.MutableRefObject<DockviewApi | null>;
  readonly ws: WorkspaceContext;
  readonly books: BookMeta[];
  readonly layoutMode: LayoutMode;
  readonly layoutModeRef: React.MutableRefObject<LayoutMode>;
  readonly isMobile: boolean | undefined;
  readonly isMobileRef: React.MutableRefObject<boolean | undefined>;
  readonly focusedSplitRatioRef: React.MutableRefObject<number>;
  readonly focusedClustersRef: React.MutableRefObject<Map<string, FocusedCluster>>;
  readonly focusedOrderRef: React.MutableRefObject<string[]>;
  readonly swapInProgressRef: React.MutableRefObject<boolean>;
  readonly getActiveClusterId: () => string | null;
  readonly enforceSingleFocusedCluster: () => void;
  readonly updateSettings: (patch: Partial<Settings>) => void;
  readonly setOpenBookIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export interface UseWorkspaceLayoutResult {
  readonly layoutReady: boolean;
  readonly onReady: (event: DockviewReadyEvent) => void;
}

export function useWorkspaceLayout({
  apiRef,
  ws,
  books,
  layoutMode,
  layoutModeRef,
  isMobile,
  isMobileRef,
  focusedSplitRatioRef,
  focusedClustersRef,
  focusedOrderRef,
  swapInProgressRef,
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
  const prevLayoutModeRef = useRef(layoutMode);
  const modeSwitchInProgressRef = useRef(false);
  const modeSwitchTokenRef = useRef(0);
  const restoreTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const flushFocusedStateRef = useRef<() => void>(() => {});

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

  const restoreFocusedState = useCallback(
    (state: FocusedWorkspaceState | null) => {
      if (!state) return;

      const booksById = new Map(books.map((book) => [book.id, book]));
      const clustersById = new Map(state.clusters.map((cluster) => [cluster.bookId, cluster]));
      const restored = new Map<string, FocusedCluster>();
      const order: string[] = [];

      for (const bookId of state.order) {
        const cluster = clustersById.get(bookId);
        const book = booksById.get(bookId);
        if (!cluster || !book || restored.has(bookId)) continue;
        restored.set(bookId, {
          ...cluster,
          bookTitle: book.title,
          bookFormat: book.format,
        });
        order.push(bookId);
      }

      focusedClustersRef.current = restored;
      focusedOrderRef.current = order;
      ws.activeClusterBookIdRef.current =
        state.activeBookId && restored.has(state.activeBookId)
          ? state.activeBookId
          : (order[order.length - 1] ?? null);
    },
    [books, focusedClustersRef, focusedOrderRef, ws],
  );

  const flushFocusedState = useCallback(() => {
    if (layoutModeRef.current !== "focused") return;
    AppRuntime.runPromise(
      WorkspaceService.pipe(Effect.andThen((s) => s.saveFocusedState(serializeFocusedState()))),
    ).catch(console.error);
  }, [layoutModeRef, serializeFocusedState]);

  const saveFocusedState = useCallback(() => {
    if (layoutModeRef.current !== "focused") return;
    if (focusedStateSaveTimerRef.current) clearTimeout(focusedStateSaveTimerRef.current);
    focusedStateSaveTimerRef.current = setTimeout(() => {
      focusedStateSaveTimerRef.current = null;
      flushFocusedState();
    }, FOCUSED_STATE_SAVE_DEBOUNCE_MS);
  }, [flushFocusedState, layoutModeRef]);

  useEffect(() => {
    flushFocusedStateRef.current = flushFocusedState;
  }, [flushFocusedState]);

  const flushLayout = useCallback(() => {
    if (modeSwitchInProgressRef.current) return;
    const api = apiRef.current;
    if (!api) return;
    AppRuntime.runPromise(
      WorkspaceService.pipe(
        Effect.andThen((s) => s.saveLayout(prevLayoutModeRef.current, api.toJSON())),
      ),
    ).catch(console.error);
  }, [apiRef]);

  const saveLayout = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushLayout, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [flushLayout]);

  const captureFocusedRatio = useCallback(() => {
    if (isMobileRef.current) return;
    if (layoutModeRef.current !== "focused") return;
    if (swapInProgressRef.current || modeSwitchInProgressRef.current) return;
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
      if (Math.abs(nextRatio - focusedSplitRatioRef.current) < FOCUSED_RATIO_EPSILON) return;
      updateSettings({ focusedSplitRatio: nextRatio });
    }, FOCUSED_RATIO_SAVE_DEBOUNCE_MS);
  }, [
    apiRef,
    focusedClustersRef,
    focusedSplitRatioRef,
    getActiveClusterId,
    isMobileRef,
    layoutModeRef,
    swapInProgressRef,
    updateSettings,
  ]);

  const updateFocusedBookGroupChrome = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    for (const group of api.groups) {
      const isFocusedBookGroup =
        layoutModeRef.current === "focused" &&
        !isMobileRef.current &&
        group.panels.length === 1 &&
        group.panels[0]?.id.startsWith("book-");
      group.element.classList.toggle(FOCUSED_BOOK_GROUP_CLASS, isFocusedBookGroup);
    }
  }, [apiRef, isMobileRef, layoutModeRef]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      ws.dockviewApi.current = event.api;

      const mode = layoutModeRef.current;
      const restoreToken = ++restoreTokenRef.current;
      Promise.all([
        AppRuntime.runPromise(
          WorkspaceService.pipe(
            Effect.andThen((s) => s.getLayout(mode)),
            Effect.catchAll(() => Effect.succeed(null)),
          ),
        ),
        mode === "focused"
          ? AppRuntime.runPromise(
              WorkspaceService.pipe(
                Effect.andThen((s) => s.getFocusedState()),
                Effect.catchAll(() => Effect.succeed(null)),
              ),
            )
          : Promise.resolve(null),
      ])
        .then(([layout, focusedState]) => {
          if (
            !mountedRef.current ||
            restoreToken !== restoreTokenRef.current ||
            mode !== layoutModeRef.current
          ) {
            return;
          }
          if (mode === "focused") restoreFocusedState(focusedState);
          const hasFocusedRestore = mode === "focused" && focusedOrderRef.current.length > 0;
          if (layout && !hasFocusedRestore) {
            try {
              event.api.fromJSON(layout);
            } catch (err) {
              console.error("Failed to restore dockview layout:", err);
            }
          }
          if (mode === "focused") {
            enforceSingleFocusedCluster();
          }
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
        event.api.onDidActivePanelChange(updateActiveCluster),
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
      layoutModeRef,
      restoreFocusedState,
      saveLayout,
      setOpenBookIds,
      swapInProgressRef,
      updateFocusedBookGroupChrome,
      ws,
    ],
  );

  useEffect(() => {
    updateFocusedBookGroupChrome();
  }, [layoutMode, isMobile, updateFocusedBookGroupChrome]);

  useEffect(() => {
    if (layoutMode !== "focused") return;
    return ws.subscribeClusterChanges(saveFocusedState);
  }, [layoutMode, saveFocusedState, ws]);

  useEffect(() => {
    if (layoutMode !== "focused") return;
    const syncFocusedOpenBooks = () => setOpenBookIds(new Set(focusedOrderRef.current));
    syncFocusedOpenBooks();
    return ws.subscribeClusterChanges(syncFocusedOpenBooks);
  }, [focusedOrderRef, layoutMode, setOpenBookIds, ws]);

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
    const prevMode = prevLayoutModeRef.current;
    if (prevMode === layoutMode) return;

    const api = apiRef.current;
    if (!api) {
      prevLayoutModeRef.current = layoutMode;
      restoreTokenRef.current += 1;
      return;
    }

    const token = ++modeSwitchTokenRef.current;
    restoreTokenRef.current += 1;
    modeSwitchInProgressRef.current = true;
    prevLayoutModeRef.current = layoutMode;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const doSwap = async () => {
      try {
        await AppRuntime.runPromise(
          WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(prevMode, api.toJSON()))),
        ).catch(console.error);
        if (prevMode === "focused") {
          if (focusedStateSaveTimerRef.current) {
            clearTimeout(focusedStateSaveTimerRef.current);
            focusedStateSaveTimerRef.current = null;
          }
          await AppRuntime.runPromise(
            WorkspaceService.pipe(
              Effect.andThen((s) => s.saveFocusedState(serializeFocusedState())),
            ),
          ).catch(console.error);
        }
        if (token !== modeSwitchTokenRef.current) return;

        if (layoutMode === "focused") {
          enforceSingleFocusedCluster();
        } else {
          const saved = await AppRuntime.runPromise(
            WorkspaceService.pipe(
              Effect.andThen((s) => s.getLayout(layoutMode)),
              Effect.catchAll(() => Effect.succeed(null)),
            ),
          );
          if (token !== modeSwitchTokenRef.current) return;
          if (saved) {
            try {
              api.fromJSON(saved);
            } catch (err) {
              console.error("Failed to restore dockview layout for mode:", layoutMode, err);
            }
          }
        }
      } finally {
        if (token === modeSwitchTokenRef.current) {
          modeSwitchInProgressRef.current = false;
        }
      }
    };
    doSwap();
  }, [apiRef, enforceSingleFocusedCluster, layoutMode, serializeFocusedState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      restoreTokenRef.current += 1;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (focusedStateSaveTimerRef.current) {
        clearTimeout(focusedStateSaveTimerRef.current);
        flushFocusedStateRef.current();
      }
      if (focusedRatioSaveTimerRef.current) clearTimeout(focusedRatioSaveTimerRef.current);
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      ws.navigationMap.current.clear();
      ws.tocMap.current.clear();
      ws.notebookCallbackMap.current.clear();
      ws.tempHighlightMap.current.clear();
      ws.clustersRef.current.clear();
      ws.activeClusterBookIdRef.current = null;
    };
  }, [ws]);

  return { layoutReady, onReady };
}
