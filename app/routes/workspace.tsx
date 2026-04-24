import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type DockviewTheme,
  type AddPanelPositionOptions,
} from "dockview";
import { PanelLeft, X } from "lucide-react";
import type { Route } from "./+types/workspace";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useBookUpload } from "~/hooks/use-book-upload";
import { DropZone } from "~/components/drop-zone";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings } from "~/lib/settings";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { truncateTitle, sortBooks } from "~/lib/workspace-utils";
import { cn } from "~/lib/utils";
import { WorkspaceProvider, useWorkspace } from "~/lib/context/workspace-context";
import { BookReaderPanel, NotebookPanel, ChatPanel } from "~/components/workspace/panel-components";
import { NewTabPanel } from "~/components/workspace/new-tab-panel";
import { StandardEbooksPanel } from "~/components/workspace/standard-ebooks-panel";
import { WatermarkPanel } from "~/components/workspace/watermark-panel";
import { LeftHeaderActions } from "~/components/workspace/left-header-actions";
import { WorkspaceSidebar } from "~/components/workspace/workspace-sidebar";
import { ClusterBar } from "~/components/workspace/cluster-bar";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useFocusedMode } from "~/hooks/use-focused-mode";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;
/** Debounce delay for persisting dockview layout changes (ms) */
const LAYOUT_SAVE_DEBOUNCE_MS = 500;

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Readmaxxing" },
    {
      name: "description",
      content:
        "AI-assisted ebook reader with multi-pane layout, highlights, notes, and hundreds of free books.",
    },
  ];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
  return { books };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading workspace…</p>
    </div>
  );
}

const components: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  "book-reader": BookReaderPanel,
  notebook: NotebookPanel,
  "new-tab": NewTabPanel,
  "standard-ebooks": StandardEbooksPanel,
  chat: ChatPanel,
};

export default function WorkspaceRoute({ loaderData }: Route.ComponentProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceRouteInner loaderData={loaderData} />
    </WorkspaceProvider>
  );
}

function WorkspaceRouteInner({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
  const ws = useWorkspace();
  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [books, setBooks] = useState<BookMeta[]>(loaderData.books);
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const sortBy = settings.workspaceSortBy;
  const layoutMode = settings.layoutMode;
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  // Tracks the mode the dockview state currently represents. Advances only
  // after a mode-switch swap completes, so `flushLayout` always writes to
  // the slot the visible arrangement belongs to — even while the user's
  // settings have already flipped to the other mode.
  const prevLayoutModeRef = useRef(layoutMode);
  // Gate used by `flushLayout` and the debounced `saveLayout` to skip writes
  // while a mode-switch swap is mid-flight (between saving the previous
  // mode and loading the new mode).
  const modeSwitchInProgressRef = useRef(false);
  // Generation token for mode-switch swaps so a rapid flip cancels
  // in-flight work from the prior switch before it applies stale state.
  const modeSwitchTokenRef = useRef(0);
  // Track which books have TOC data via a version counter (triggers re-render)
  const [_tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());
  // Track whether dockview layout has been restored (controls fade-in)
  const [layoutReady, setLayoutReady] = useState(false);

  // Focused-mode session state, swap effect, Cmd+1..9 shortcut, and ClusterBar
  // getters live in a dedicated hook. The refs it returns are shared with
  // openBook/openNotebook/openChat below and with the dockview listeners
  // registered in `onReady`.
  const {
    focusedClustersRef,
    focusedOrderRef,
    swapInProgressRef,
    closeFocusedCluster,
    getClusterEntries,
    getActiveClusterId,
    enforceSingleFocusedCluster,
  } = useFocusedMode({ apiRef, layoutMode, isMobileRef });

  // Load last-opened timestamps for sorting
  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())),
    [],
  );

  const { openBooks, otherBooks } = useMemo(() => {
    const open: BookMeta[] = [];
    const other: BookMeta[] = [];
    for (const book of books) {
      if (openBookIds.has(book.id)) {
        open.push(book);
      } else {
        other.push(book);
      }
    }
    open.sort((a, b) => a.title.localeCompare(b.title));
    const sortedOther = sortBooks(other, sortBy, lastOpenedMap);
    return { openBooks: open, otherBooks: sortedOther };
  }, [books, sortBy, lastOpenedMap, openBookIds]);

  const dockviewTheme: DockviewTheme = {
    name: "app",
    className: "dockview-theme-app",
  };

  // Flush layout to IndexedDB immediately (non-debounced). Writes to
  // `prevLayoutModeRef` — the mode the dockview state currently represents
  // — not the settings' `layoutModeRef`, which may have already flipped to
  // the other mode. Skips while a mode-switch swap is mid-flight so we
  // don't persist a half-loaded transitional state.
  const flushLayout = useCallback(() => {
    if (modeSwitchInProgressRef.current) return;
    const api = apiRef.current;
    if (!api) return;
    const layout = api.toJSON();
    const mode = prevLayoutModeRef.current;
    AppRuntime.runPromise(
      WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(mode, layout))),
    ).catch(console.error);
  }, []);

  // Debounced layout save
  const saveLayout = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushLayout, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [flushLayout]);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      ws.dockviewApi.current = event.api;

      // Try to restore saved layout for the active mode
      const mode = layoutModeRef.current;
      AppRuntime.runPromise(
        WorkspaceService.pipe(
          Effect.andThen((s) => s.getLayout(mode)),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      )
        .then((layout) => {
          if (layout) {
            try {
              event.api.fromJSON(layout);
            } catch (err) {
              console.error("Failed to restore dockview layout:", err);
            }
          }
          // In focused mode, reconcile any restored/carried panels into
          // tracked clusters and enforce the single-cluster-visible
          // invariant. No-op when no cluster panels are mounted.
          if (mode === "focused") {
            enforceSingleFocusedCluster();
          }
          setLayoutReady(true);
        })
        .catch((err) => {
          console.error(err);
          setLayoutReady(true);
        });

      // Track open book panels
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

      // Rebuild the BookCluster map from current dockview panels. Each cluster
      // is keyed by bookId and groups that book's reader/chat/notebook panels.
      // Clusters without a book-reader panel are excluded (transient state).
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
        // Keep the focused-mode session map in sync: when a chat/notebook
        // panel is added/removed for a tracked cluster, update its flags so
        // future swaps recreate the same tab set.
        for (const [bookId, fc] of focusedClustersRef.current) {
          const entry = next.get(bookId);
          if (!entry) continue;
          fc.hasChat = entry.chatPanelId !== undefined;
          fc.hasNotebook = entry.notebookPanelId !== undefined;
        }
        // If the active cluster's book was closed, clear the active bookId.
        // Skip this during a focused-mode swap: dockview fires remove/add
        // events synchronously while swapFocusedCluster is mid-flight, and
        // the intermediate state (old panels gone, new ones not yet added)
        // would spuriously clear the active cluster.
        if (!swapInProgressRef.current) {
          const activeId = ws.activeClusterBookIdRef.current;
          if (activeId && !next.has(activeId)) {
            ws.activeClusterBookIdRef.current = null;
          }
        }
        ws.notifyClusterChanges();
      };
      rebuildClusters();

      // Track the active cluster based on which panel is focused. Panels
      // outside any cluster (Standard Ebooks, new-tab) leave the active
      // cluster unchanged.
      const updateActiveCluster = (panel: { params?: unknown } | undefined) => {
        if (!panel) return;
        // Ignore focus changes we triggered ourselves during a swap.
        if (swapInProgressRef.current) return;
        const bookId = (panel.params as Record<string, unknown>)?.bookId;
        if (typeof bookId !== "string") return;
        if (!ws.clustersRef.current.has(bookId)) return;
        if (ws.activeClusterBookIdRef.current === bookId) return;
        ws.activeClusterBookIdRef.current = bookId;
        // Remember which tab the user focused so the next swap restores it.
        const fc = focusedClustersRef.current.get(bookId);
        if (fc) {
          const id = (panel as { id?: string }).id;
          if (id?.startsWith("chat-")) fc.activeTab = "chat";
          else if (id?.startsWith("notebook-")) fc.activeTab = "notebook";
          else if (id?.startsWith("book-")) fc.activeTab = "book";
        }
        ws.notifyClusterChanges();
      };

      // Store disposables for cleanup on unmount
      // In dockview v5, onDidLayoutChange does not fire for panel add/remove/move,
      // so we must also listen to those events to persist layout changes.
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
      ];
    },
    [saveLayout, ws, enforceSingleFocusedCluster],
  );

  // Flush pending layout save on page unload / tab hide
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushLayout]);

  // React to `layoutMode` settings changes by swapping the dockview state:
  //   1. Flush the current dockview JSON to the *previous* mode's IDB slot.
  //   2. Load the new mode's saved layout (if any) into dockview; otherwise
  //      keep the current panels so the user doesn't lose their open books.
  //   3. If the new mode is focused, reconcile focusedClustersRef from the
  //      mounted panels and enforce the single-cluster-visible invariant.
  // `modeSwitchInProgressRef` gates `flushLayout` so partial transitional
  // states don't get persisted, and `modeSwitchTokenRef` cancels stale
  // in-flight work if the user flips modes rapidly.
  useEffect(() => {
    const prevMode = prevLayoutModeRef.current;
    if (prevMode === layoutMode) return;

    const api = apiRef.current;
    if (!api) {
      // Dockview hasn't mounted yet; `onReady` will pick up the new mode.
      prevLayoutModeRef.current = layoutMode;
      return;
    }

    const token = ++modeSwitchTokenRef.current;
    modeSwitchInProgressRef.current = true;
    // Advance the ref up-front so any flush that slips past the guard
    // writes to the destination slot rather than the source slot.
    prevLayoutModeRef.current = layoutMode;
    // Cancel any pending debounced save so it doesn't fire with the old
    // mode's layout JSON after we've already started the swap.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const doSwap = async () => {
      try {
        const currentLayout = api.toJSON();
        await AppRuntime.runPromise(
          WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(prevMode, currentLayout))),
        ).catch(console.error);
        if (token !== modeSwitchTokenRef.current) return;

        if (layoutMode === "focused") {
          // Focused mode derives its visible layout from `focusedClustersRef`
          // (session-scoped "open books" set) plus the single active cluster
          // — not the saved JSON, which only ever captured the active cluster.
          // `enforceSingleFocusedCluster` reconciles the tracked-cluster map
          // from any currently-mounted book panels (so freeform panels carry
          // over as pills) and drives a swap to the active cluster, which
          // in turn removes any non-active cluster panels still mounted.
          enforceSingleFocusedCluster();
        } else {
          // Freeform mode: restore the saved multi-panel arrangement if
          // one exists. Otherwise keep the current panels so the user
          // doesn't lose their open books when switching from focused
          // the first time.
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
  }, [layoutMode, enforceSingleFocusedCluster]);

  // Sync books to context ref so NewTabPanel (and other consumers) can read them.
  // Done in an effect so it happens after commit, not during render.
  useEffect(() => {
    ws.booksRef.current = books;
  }, [books, ws]);

  // Register TOC change listener (safe to re-run when ws changes)
  useEffect(() => {
    ws.tocChangeListener.current = () => setTocVersion((v) => v + 1);
    return () => {
      ws.tocChangeListener.current = null;
    };
  }, [ws]);

  // Cleanup dockview disposables and maps only on unmount —
  // these must NOT be disposed on context value changes, because
  // onReady only registers them once per mount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      ws.navigationMap.current.clear();
      ws.tocMap.current.clear();
      ws.notebookCallbackMap.current.clear();
      ws.tempHighlightMap.current.clear();
      ws.clustersRef.current.clear();
      ws.activeClusterBookIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd+B / Ctrl+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        updateSettings({ sidebarCollapsed: !collapsed });
        // After the sidebar CSS transition completes, notify dockview
        // and epub renditions that the container dimensions changed.
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, SIDEBAR_TRANSITION_MS);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, updateSettings]);

  // Keyboard shortcuts: Cmd+[/] for tab cycling, Ctrl+h/j/k/l for pane navigation
  useEffect(() => {
    function isEditableElement(): boolean {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return true;
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    }

    function handleKeyDown(e: KeyboardEvent) {
      const api = apiRef.current;
      if (!api) return;

      // Cmd+[ / Cmd+] — cycle tabs in active group
      if (e.metaKey && (e.key === "[" || e.key === "]")) {
        if (isEditableElement()) return;
        const group = api.activeGroup;
        if (!group || group.panels.length < 2) return;
        e.preventDefault();
        const panels = group.panels;
        const activePanel = group.activePanel;
        const currentIndex = activePanel ? panels.indexOf(activePanel) : 0;
        const delta = e.key === "]" ? 1 : -1;
        const nextIndex = (currentIndex + delta + panels.length) % panels.length;
        panels[nextIndex].focus();
        return;
      }

      // Ctrl+h/j/k/l — directional pane navigation (skip when typing)
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const dirMap: Record<string, "left" | "down" | "up" | "right"> = {
          h: "left",
          j: "down",
          k: "up",
          l: "right",
        };
        const direction = dirMap[e.key];
        if (!direction) return;
        if (isEditableElement()) return;

        const group = api.activeGroup;
        if (!group) return;
        e.preventDefault();

        const currentRect = group.element.getBoundingClientRect();
        const cx = currentRect.left + currentRect.width / 2;
        const cy = currentRect.top + currentRect.height / 2;

        let bestGroup: typeof group | null = null;
        let bestDist = Infinity;

        for (const g of api.groups) {
          if (g === group) continue;
          const r = g.element.getBoundingClientRect();
          const gx = r.left + r.width / 2;
          const gy = r.top + r.height / 2;

          let isCandidate = false;
          let dist = 0;
          switch (direction) {
            case "left":
              isCandidate = gx < cx;
              dist = cx - gx;
              break;
            case "right":
              isCandidate = gx > cx;
              dist = gx - cx;
              break;
            case "up":
              isCandidate = gy < cy;
              dist = cy - gy;
              break;
            case "down":
              isCandidate = gy > cy;
              dist = gy - cy;
              break;
          }

          if (isCandidate && dist < bestDist) {
            bestDist = dist;
            bestGroup = g;
          }
        }

        if (bestGroup) {
          const target = bestGroup.activePanel ?? bestGroup.panels[0];
          if (target) target.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Add a book-reader panel for `book` (no companion panels). Returns nothing.
  const addBookPanel = useCallback((book: BookMeta) => {
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
  }, []);

  const openBook = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;

      // Record last-opened timestamp
      AppRuntime.runPromise(
        WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened(book.id, Date.now()))),
      ).catch(console.error);

      const mode = layoutModeRef.current;
      const isFirstCluster =
        mode === "focused"
          ? focusedClustersRef.current.size === 0
          : !api.panels.some((p) => p.id.startsWith("book-"));

      if (mode === "focused") {
        // Ensure a focused cluster entry exists for this book. Chat is
        // eager on desktop (matches the prior companion-chat behavior);
        // notebook is lazy — added the first time the user clicks the
        // "Open Notebook" button so the right group stays uncluttered
        // until explicitly requested.
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
        // Activate the cluster; the swap effect reacts and mounts panels.
        ws.setActiveCluster(book.id);
      } else {
        // Freeform: preserve legacy behavior — focus existing panel if any,
        // otherwise add book panel (+ companion chat when opening into an
        // empty workspace on a wide screen).
        const existing = api.panels.find(
          (p) =>
            p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
        );
        if (existing) {
          existing.focus();
          return;
        }
        addBookPanel(book);
        if (isFirstCluster && !isMobileRef.current && window.innerWidth > 1000) {
          const chatId = `chat-${book.id}`;
          api.addPanel({
            id: chatId,
            component: "chat",
            title: truncateTitle(`Discuss: ${book.title}`),
            params: { bookId: book.id, bookTitle: book.title },
            renderer: "always",
            position: { referencePanel: `book-${book.id}`, direction: "right" },
          });
        }
      }

      // Auto-collapse sidebar on first book in either mode.
      if (isFirstCluster && !isMobileRef.current && !collapsedRef.current) {
        updateSettings({ sidebarCollapsed: true });
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, SIDEBAR_TRANSITION_MS);
      }
    },
    [addBookPanel, updateSettings, ws],
  );

  const openNotebook = useCallback(
    (book: BookMeta) => {
      const api = apiRef.current;
      if (!api) return;

      const panelId = `notebook-${book.id}`;
      const mode = layoutModeRef.current;

      if (mode === "focused") {
        // Ensure a cluster exists and is the active one, then add/focus the
        // notebook tab inside its right group.
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
        // Active cluster but notebook not mounted — add as tab in the right
        // group if one exists, else split right from the book panel.
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

      // Freeform: legacy behavior — split right next to the book panel.
      const existing = api.panels.find((p) => p.id === panelId);
      if (existing) {
        existing.focus();
        return;
      }
      const bookPanel = api.panels.find(
        (p) =>
          p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
      );
      let position: AddPanelPositionOptions | undefined;
      if (!isMobileRef.current && bookPanel) {
        const bookGroup = bookPanel.group;
        const bookRect = bookGroup.element.getBoundingClientRect();
        const rightGroup = api.groups.find(
          (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
        );
        if (rightGroup) {
          position = { referenceGroup: rightGroup };
        } else {
          position = { referencePanel: bookPanel.id, direction: "right" as const };
        }
      }
      api.addPanel({
        id: panelId,
        component: "notebook",
        title: truncateTitle(`Notes: ${book.title}`),
        params: { bookId: book.id, bookTitle: book.title },
        renderer: "always",
        ...(position ? { position } : {}),
      });
    },
    [ws],
  );

  const openStandardEbooks = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.id.startsWith("standard-ebooks-"));
    if (existing) {
      existing.focus();
      return;
    }
    const panelId = `standard-ebooks-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "standard-ebooks",
      title: "Standard Ebooks",
      params: {},
    });
  }, []);

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

      // Freeform: legacy behavior.
      const existing = api.panels.find((p) => p.id === panelId);
      if (existing) {
        existing.focus();
        return;
      }
      const bookPanel = api.panels.find(
        (p) =>
          p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
      );
      let position: AddPanelPositionOptions | undefined;
      if (!isMobileRef.current && bookPanel) {
        const bookGroup = bookPanel.group;
        const bookRect = bookGroup.element.getBoundingClientRect();
        const rightGroup = api.groups.find(
          (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
        );
        if (rightGroup) {
          position = { referenceGroup: rightGroup };
        } else {
          position = { referencePanel: bookPanel.id, direction: "right" as const };
        }
      }
      api.addPanel({
        id: panelId,
        component: "chat",
        title: truncateTitle(`Discuss: ${book.title}`),
        params: { bookId: book.id, bookTitle: book.title },
        renderer: "always",
        ...(position ? { position } : {}),
      });
    },
    [ws],
  );

  // Wrap setBooks to also update booksRef and notify booksChangeListener.
  // Both the ref mutation and listener notification happen in a queueMicrotask
  // AFTER the setBooks call, so they don't run during another component's
  // render/commit (which would trigger a "setState during render" warning
  // when the listener calls setBooks on LibraryBrowseContent).
  const updateBooks = useCallback(
    (updater: (prev: BookMeta[]) => BookMeta[]) => {
      let next: BookMeta[] | undefined;
      setBooks((prev) => {
        next = updater(prev);
        return next;
      });
      queueMicrotask(() => {
        if (next !== undefined) {
          ws.booksRef.current = next;
        }
        ws.booksChangeListener.current?.();
      });
    },
    [ws],
  );

  // Reload books when sync pulls book data
  const syncVersion = useSyncListener(["book"]);
  useEffect(() => {
    if (syncVersion === 0) return;
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())))
      .then((freshBooks) => updateBooks(() => freshBooks))
      .catch(console.error);
  }, [syncVersion, updateBooks]);

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      updateBooks((prev) => [...prev, book]);
      openBook(book);
    },
    [openBook, updateBooks],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      updateBooks((prev) => prev.filter((b) => b.id !== bookId));
    },
    [updateBooks],
  );

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });

  // Sync context refs so child panels can open books/notebooks/chats and trigger uploads
  ws.openBookRef.current = openBook;
  ws.openNotebookRef.current = openNotebook;
  ws.openChatRef.current = openChat;
  ws.openStandardEbooksRef.current = openStandardEbooks;
  ws.onBookAddedRef.current = handleBookAdded;
  ws.onBookDeletedRef.current = handleBookDeleted;

  const sidebarProps = {
    collapsed,
    sortBy,
    layoutMode,
    openBooks,
    otherBooks,
    onUpdateSettings: updateSettings,
    onOpenBook: (book: BookMeta) => {
      openBook(book);
      setMobileOpen(false);
    },
    onOpenNotebook: (book: BookMeta) => {
      openNotebook(book);
      setMobileOpen(false);
    },
    onFileInput: handleFileInput,
  };

  return (
    <DropZone onBookAdded={handleBookAdded}>
      <div
        className={cn(
          "flex h-dvh",
          layoutReady ? "animate-in fade-in-0 duration-300" : "opacity-0",
        )}
      >
        {/* Desktop sidebar — hidden on mobile */}
        {isMobile !== true && <WorkspaceSidebar {...sidebarProps} />}

        {/* Mobile floating pill + sheet sidebar */}
        {isMobile === true && (
          <>
            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              className={cn(
                "fixed bottom-12 right-2 z-50 flex items-center justify-center rounded-full border border-border/50 bg-card/80 p-4 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-card hover:text-foreground active:bg-accent",
                {
                  "z-[60]": mobileOpen,
                },
              )}
              aria-label={mobileOpen ? "Close sidebar" : "Open sidebar"}
            >
              {mobileOpen ? <X className="size-4" /> : <PanelLeft className="size-4" />}
            </button>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent side="left" className="w-75 p-0" showCloseButton={false}>
                <SheetHeader className="sr-only">
                  <SheetTitle>Library</SheetTitle>
                  <SheetDescription>Book library navigation</SheetDescription>
                </SheetHeader>
                <WorkspaceSidebar {...sidebarProps} collapsed={false} />
              </SheetContent>
            </Sheet>
          </>
        )}

        {/* Dockview container — full width when sidebar is collapsed or on mobile */}
        <div className="flex flex-1 flex-col">
          {layoutMode === "focused" && (
            <ClusterBar
              getEntries={getClusterEntries}
              getActiveId={getActiveClusterId}
              onActivate={(bookId) => ws.setActiveCluster(bookId)}
              onClose={closeFocusedCluster}
            />
          )}
          <div className="flex-1 min-h-0">
            <DockviewReact
              theme={dockviewTheme}
              components={components}
              watermarkComponent={WatermarkPanel}
              leftHeaderActionsComponent={LeftHeaderActions}
              onReady={onReady}
              disableDnd={layoutMode === "focused"}
              disableFloatingGroups={layoutMode === "focused"}
            />
          </div>
        </div>
      </div>
    </DropZone>
  );
}
