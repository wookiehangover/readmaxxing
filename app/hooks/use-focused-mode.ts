import { useCallback, useEffect, useRef } from "react";
import type { DockviewApi, AddPanelPositionOptions } from "dockview";
import { useWorkspace } from "~/lib/context/workspace-context";
import { truncateTitle } from "~/lib/workspace-utils";
import type { LayoutMode } from "~/lib/settings";

/**
 * Session-scoped state for a single focused-mode cluster. Persisted only in
 * memory — if the user reloads, focused clusters re-populate as they open
 * books (cluster panel content is re-mounted from IDB/Postgres on demand).
 */
export interface FocusedCluster {
  bookId: string;
  bookTitle: string;
  bookFormat?: string;
  hasChat: boolean;
  hasNotebook: boolean;
  activeTab: "book" | "chat" | "notebook";
}

export interface ClusterBarEntry {
  readonly bookId: string;
  readonly bookTitle: string;
}

export interface UseFocusedModeParams {
  /** Current dockview API ref owned by workspace.tsx. */
  apiRef: React.MutableRefObject<DockviewApi | null>;
  /** Active layout mode; the swap and Cmd+1..9 effects are inert in freeform. */
  layoutMode: LayoutMode;
  /** Mobile viewport ref, read during cluster swap for tab/split decisions. */
  isMobileRef: React.MutableRefObject<boolean | undefined>;
}

export interface UseFocusedModeResult {
  readonly focusedClustersRef: React.MutableRefObject<Map<string, FocusedCluster>>;
  readonly focusedOrderRef: React.MutableRefObject<string[]>;
  readonly swapInProgressRef: React.MutableRefObject<boolean>;
  readonly closeFocusedCluster: (bookId: string) => void;
  readonly getClusterEntries: () => ClusterBarEntry[];
  readonly getActiveClusterId: () => string | null;
  /**
   * Reconcile `focusedClustersRef` from the current dockview panel list and
   * swap down to a single active cluster. Called after a mode switch and on
   * initial `onReady` when layoutMode is "focused", so panels that weren't
   * opened through `openBook` (restored from saved JSON, carried over from
   * freeform) become tracked clusters and the one-cluster-visible invariant
   * is restored.
   */
  readonly enforceSingleFocusedCluster: () => void;
}

function isEditableElement(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Encapsulates focused-mode session state, the swap effect that (un)mounts
 * cluster panels when the active cluster changes, the Cmd+1..9 shortcut,
 * the close-cluster handler, and ClusterBar getters. The returned refs are
 * shared with workspace.tsx's openBook/openNotebook/openChat and with the
 * dockview listeners registered in `onReady`.
 */
export function useFocusedMode({
  apiRef,
  layoutMode,
  isMobileRef,
}: UseFocusedModeParams): UseFocusedModeResult {
  const ws = useWorkspace();
  const focusedClustersRef = useRef(new Map<string, FocusedCluster>());
  const focusedOrderRef = useRef<string[]>([]);
  // Last cluster bookId the swap effect acted on. Prevents re-running swap
  // logic for the same activation (which would re-mount panels unnecessarily).
  const lastSwappedRef = useRef<string | null>(null);
  // Guard to suppress the onDidActivePanelChange → setActiveCluster feedback
  // loop while the swap effect is mid-swap (removing/adding panels).
  const swapInProgressRef = useRef(false);

  // Mount the panels for `targetBookId`'s focused cluster, removing any
  // currently-mounted cluster panels first. Called whenever the active
  // focused cluster changes. Content state (reading position, notebook,
  // chat) is rehydrated from IDB/Postgres when the panel remounts.
  const swapFocusedCluster = useCallback(
    (targetBookId: string | null) => {
      const api = apiRef.current;
      if (!api) return;

      // If we have a target but no tracked-cluster entry for it yet, leave
      // dockview untouched. This happens briefly during a freeform→focused
      // mode switch: the subscriber may fire before
      // `enforceSingleFocusedCluster` has reconciled the cluster map, and
      // running the remove-loop here would strip panels we're about to
      // absorb into tracked clusters. The reconcile path will invoke us
      // again (with lastSwappedRef primed) once the map is populated.
      if (targetBookId !== null && !focusedClustersRef.current.has(targetBookId)) {
        return;
      }

      swapInProgressRef.current = true;
      try {
        // Remove every cluster-prefix panel whose bookId isn't the target.
        // Enumerating by id prefix (not by tracked-cluster map) catches
        // panels that dockview restored from saved JSON or that were
        // carried over from freeform mode but haven't been added to
        // `focusedClustersRef` yet.
        const toRemove = api.panels.filter((p) => {
          const isClusterPanel =
            p.id.startsWith("book-") || p.id.startsWith("chat-") || p.id.startsWith("notebook-");
          if (!isClusterPanel) return false;
          const bId = (p.params as Record<string, unknown>)?.bookId;
          if (typeof bId !== "string") return false;
          return bId !== targetBookId;
        });
        for (const p of toRemove) api.removePanel(p);

        if (!targetBookId) return;
        const cluster = focusedClustersRef.current.get(targetBookId);
        if (!cluster) return;

        const { bookId, bookTitle, bookFormat, hasChat, hasNotebook, activeTab } = cluster;

        // Add the book panel if not already mounted — when swapping to a
        // cluster whose panels were already in dockview (freeform →
        // focused), the remove-step above leaves them in place and we
        // skip re-adding.
        const bookPanelId = `book-${bookId}`;
        if (!api.panels.some((p) => p.id === bookPanelId)) {
          api.addPanel({
            id: bookPanelId,
            component: "book-reader",
            title: truncateTitle(bookTitle),
            params: { bookId, bookTitle, bookFormat },
            renderer: "always",
          });
        }

        const rightSplit = !isMobileRef.current;

        // Add chat panel (right split on desktop, tab on mobile).
        if (hasChat) {
          const chatPanelId = `chat-${bookId}`;
          if (!api.panels.some((p) => p.id === chatPanelId)) {
            api.addPanel({
              id: chatPanelId,
              component: "chat",
              title: truncateTitle(`Discuss: ${bookTitle}`),
              params: { bookId, bookTitle },
              renderer: "always",
              ...(rightSplit
                ? { position: { referencePanel: bookPanelId, direction: "right" as const } }
                : {}),
            });
          }
        }

        // Add notebook panel — as a tab in the right group if chat exists,
        // otherwise split right (desktop) or tab (mobile).
        if (hasNotebook) {
          const notebookPanelId = `notebook-${bookId}`;
          if (!api.panels.some((p) => p.id === notebookPanelId)) {
            const chatPanel = hasChat
              ? api.panels.find((p) => p.id === `chat-${bookId}`)
              : undefined;
            const position: AddPanelPositionOptions | undefined = rightSplit
              ? chatPanel
                ? { referenceGroup: chatPanel.group }
                : { referencePanel: bookPanelId, direction: "right" as const }
              : undefined;
            api.addPanel({
              id: notebookPanelId,
              component: "notebook",
              title: truncateTitle(`Notes: ${bookTitle}`),
              params: { bookId, bookTitle },
              renderer: "always",
              ...(position ? { position } : {}),
            });
          }
        }

        // Focus the remembered active tab so pill-switching feels continuous.
        let focusId = bookPanelId;
        if (activeTab === "chat" && hasChat) focusId = `chat-${bookId}`;
        else if (activeTab === "notebook" && hasNotebook) focusId = `notebook-${bookId}`;
        const focusPanel = api.panels.find((p) => p.id === focusId);
        if (focusPanel) focusPanel.focus();
      } finally {
        swapInProgressRef.current = false;
      }
    },
    [apiRef, isMobileRef],
  );

  // Subscribe to cluster-change notifications and run the swap whenever the
  // active focused cluster changes. Uses `lastSwappedRef` to ignore
  // re-notifications for the same active id (which also occurs while the
  // swap itself is adding panels).
  useEffect(() => {
    if (layoutMode !== "focused") return;
    const run = () => {
      // Dockview fires onDidRemovePanel synchronously during the swap's
      // remove loop, which triggers rebuildClusters → notifyClusterChanges
      // → this listener. Bail out while a swap is mid-flight so we don't
      // re-enter swapFocusedCluster and operate on already-removed panels.
      if (swapInProgressRef.current) return;
      const target = ws.activeClusterBookIdRef.current;
      if (target === lastSwappedRef.current) return;
      lastSwappedRef.current = target;
      swapFocusedCluster(target);
    };
    // Initial sync in case a cluster was already active when the subscription
    // was (re-)established (e.g. after a mode toggle).
    run();
    return ws.subscribeClusterChanges(run);
  }, [layoutMode, swapFocusedCluster, ws]);

  // Cmd+1..9 to activate the Nth open focused cluster. Skips editable
  // elements so typing "1" in an input doesn't swap clusters.
  useEffect(() => {
    if (layoutMode !== "focused") return;
    function handler(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const digit = Number.parseInt(e.key, 10);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      if (isEditableElement()) return;
      const order = focusedOrderRef.current;
      const target = order[digit - 1];
      if (!target) return;
      e.preventDefault();
      ws.setActiveCluster(target);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [layoutMode, ws]);

  // Close a focused-mode cluster: remove from the session map and either
  // activate the next cluster in order or clear panels entirely. When the
  // closed cluster is the active one, the swap must remove its mounted
  // panels — so we keep the entry in focusedClustersRef (the "tracked" set
  // the swap uses to find panels to remove) until the swap has run.
  const closeFocusedCluster = useCallback(
    (bookId: string) => {
      const wasActive = ws.activeClusterBookIdRef.current === bookId;
      const remainingOrder = focusedOrderRef.current.filter((id) => id !== bookId);

      if (wasActive) {
        const nextId = remainingOrder[remainingOrder.length - 1] ?? null;
        if (nextId === null) {
          ws.activeClusterBookIdRef.current = null;
          swapFocusedCluster(null);
          lastSwappedRef.current = null;
        } else {
          // Swap first (while bookId is still tracked so its panels are
          // removed); setActiveCluster drives the subscriber into
          // swapFocusedCluster(nextId).
          ws.setActiveCluster(nextId);
        }
      }

      focusedClustersRef.current.delete(bookId);
      focusedOrderRef.current = remainingOrder;
      ws.notifyClusterChanges();
    },
    [swapFocusedCluster, ws],
  );

  // Reconcile the tracked-cluster map from dockview's panel list, then swap
  // down to a single active cluster. Used after a mode toggle (freeform →
  // focused) and on initial `onReady` when layoutMode is "focused" to absorb
  // any panels that weren't routed through openBook/openNotebook/openChat.
  const enforceSingleFocusedCluster = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    // Group mounted panels by bookId.
    type PanelInfo = {
      hasBook: boolean;
      hasChat: boolean;
      hasNotebook: boolean;
      title?: string;
      format?: string;
    };
    const byBook = new Map<string, PanelInfo>();
    for (const p of api.panels) {
      const params = p.params as Record<string, unknown> | undefined;
      const bookId = params?.bookId;
      if (typeof bookId !== "string") continue;
      const entry = byBook.get(bookId) ?? { hasBook: false, hasChat: false, hasNotebook: false };
      if (p.id.startsWith("book-")) {
        entry.hasBook = true;
        const title = params?.bookTitle;
        if (typeof title === "string") entry.title = title;
        const format = params?.bookFormat;
        if (typeof format === "string") entry.format = format;
      } else if (p.id.startsWith("chat-")) entry.hasChat = true;
      else if (p.id.startsWith("notebook-")) entry.hasNotebook = true;
      byBook.set(bookId, entry);
    }

    // Merge into focusedClustersRef / focusedOrderRef: add new, update existing.
    const order = [...focusedOrderRef.current];
    for (const [bookId, info] of byBook) {
      if (!info.hasBook) continue; // book reader panel is the anchor
      const existing = focusedClustersRef.current.get(bookId);
      if (!existing) {
        focusedClustersRef.current.set(bookId, {
          bookId,
          bookTitle: info.title ?? bookId,
          bookFormat: info.format,
          hasChat: info.hasChat,
          hasNotebook: info.hasNotebook,
          activeTab: info.hasChat ? "chat" : info.hasNotebook ? "notebook" : "book",
        });
        if (!order.includes(bookId)) order.push(bookId);
      } else {
        existing.hasChat = info.hasChat;
        existing.hasNotebook = info.hasNotebook;
        if (info.title) existing.bookTitle = info.title;
        if (info.format) existing.bookFormat = info.format;
      }
    }
    // Note: we do NOT drop tracked clusters whose book reader isn't
    // mounted. Focused mode's saved JSON only captures the single active
    // cluster, so after a fromJSON the other pills' panels aren't present
    // yet — but their entries in `focusedClustersRef` must persist so the
    // ClusterBar keeps rendering pills and clicking one re-adds the book.
    focusedOrderRef.current = order.filter((id) => focusedClustersRef.current.has(id));

    // Pick a target: prefer the currently-active cluster if still valid,
    // otherwise the last-opened tracked cluster.
    const activeId = ws.activeClusterBookIdRef.current;
    const isActiveValid = activeId !== null && focusedClustersRef.current.has(activeId);
    const target = isActiveValid
      ? activeId
      : (focusedOrderRef.current[focusedOrderRef.current.length - 1] ?? null);

    // Drive the swap directly (bypassing the subscriber) so we can reset
    // `lastSwappedRef` deterministically and ensure it runs even when the
    // target matches a stale `lastSwappedRef` from before the mode switch.
    ws.activeClusterBookIdRef.current = target;
    lastSwappedRef.current = target;
    swapFocusedCluster(target);
    ws.notifyClusterChanges();
  }, [apiRef, swapFocusedCluster, ws]);

  // ClusterBar getters — return snapshots from the refs. ClusterBar
  // subscribes to cluster changes separately to trigger re-renders.
  const getClusterEntries = useCallback((): ClusterBarEntry[] => {
    return focusedOrderRef.current.map((bookId) => {
      const fc = focusedClustersRef.current.get(bookId);
      return { bookId, bookTitle: fc?.bookTitle ?? bookId };
    });
  }, []);
  const getActiveClusterId = useCallback(() => ws.activeClusterBookIdRef.current, [ws]);

  return {
    focusedClustersRef,
    focusedOrderRef,
    swapInProgressRef,
    closeFocusedCluster,
    getClusterEntries,
    getActiveClusterId,
    enforceSingleFocusedCluster,
  };
}
