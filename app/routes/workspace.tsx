import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Effect } from "effect";
import {
  DockviewReact,
  type IDockviewPanelProps,
  type DockviewApi,
  type DockviewTheme,
} from "dockview";
import { PanelLeft, X } from "lucide-react";
import type { Route } from "./+types/workspace";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useBookUpload } from "~/hooks/use-book-upload";
import { DropZone } from "~/components/drop-zone";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { clampFocusedSplitRatio, type ReaderLayout, useSettings } from "~/lib/settings";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { sortBooks } from "~/lib/workspace-utils";
import { cn } from "~/lib/utils";
import { useWorkspace } from "~/lib/context/workspace-context";
import { BookReaderPanel, NotebookPanel, ChatPanel } from "~/components/workspace/panel-components";
import { BookmarksPanel } from "~/components/workspace/bookmarks-panel";
import { ReadingHistoryPanel } from "~/components/workspace/reading-history-panel";
import { NewTabPanel } from "~/components/workspace/new-tab-panel";
import { StandardEbooksPanel } from "~/components/workspace/standard-ebooks-panel";
import { WatermarkPanel } from "~/components/workspace/watermark-panel";
import { LeftHeaderActions } from "~/components/workspace/left-header-actions";
import { WorkspaceSidebar } from "~/components/workspace/workspace-sidebar";
import { ClusterBar } from "~/components/workspace/cluster-bar";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useFocusedMode } from "~/hooks/use-focused-mode";
import { useWorkspaceLayout } from "~/hooks/use-workspace-layout";
import { useWorkspacePanels } from "~/hooks/use-workspace-panels";
import { useWorkspaceShortcuts } from "~/hooks/use-workspace-shortcuts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";

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
  bookmarks: BookmarksPanel,
  "reading-history": ReadingHistoryPanel,
};

const SIDEBAR_TRANSITION_MS = 270;

type ZenPreState = {
  readonly sidebarCollapsed: boolean;
  readonly readerLayout: ReaderLayout;
  readonly dockviewJson: ReturnType<DockviewApi["toJSON"]> | undefined;
};

export default function WorkspaceRoute({ loaderData }: Route.ComponentProps) {
  return <WorkspaceRouteInner loaderData={loaderData} />;
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
  const zenMode = settings.zenMode;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const readerLayout = settings.readerLayout;
  const readerLayoutRef = useRef(readerLayout);
  readerLayoutRef.current = readerLayout;
  const prevZenModeRef = useRef(zenMode);
  const zenPreStateRef = useRef<ZenPreState | null>(null);
  const sortBy = settings.workspaceSortBy;
  const layoutMode = settings.layoutMode;
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;
  const apiRef = useRef<DockviewApi | null>(null);
  // Track which books have TOC data via a version counter (triggers re-render)
  const [_tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());

  // Identity-stable setter: bail when the new set has the same contents as the
  // current one. Callers (`updateOpenBooks`, `syncFocusedOpenBooks`) always pass
  // a fresh `new Set(...)`, so without this guard the `openBookIds` effect below
  // re-fires `notifyClusterChanges()` on every cluster notification, which calls
  // `syncFocusedOpenBooks` again -> new Set -> notify -> ... an infinite loop.
  const setOpenBookIdsStable = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (action) => {
      setOpenBookIds((prev) => {
        const next = typeof action === "function" ? action(prev) : action;
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  // Focused-mode book/right split ratio (book-group width / total width).
  // Held in a ref so the swap callback in `useFocusedMode` can read the
  // latest value without re-creating itself when settings change.
  const focusedSplitRatioRef = useRef(clampFocusedSplitRatio(settings.focusedSplitRatio));
  focusedSplitRatioRef.current = clampFocusedSplitRatio(settings.focusedSplitRatio);

  // Focused-mode session state, swap effect, Cmd+1..9 shortcut, and ClusterBar
  // getters live in a dedicated hook. The refs it returns are shared with
  // openBook/openNotebook/openChat below and with the dockview listeners
  // registered in `onReady`.
  const {
    focusedClustersRef,
    focusedOrderRef,
    swapInProgressRef,
    closeFocusedCluster,
    reorderFocusedClusters,
    getClusterEntries,
    getActiveClusterId,
    enforceSingleFocusedCluster,
  } = useFocusedMode({ apiRef, layoutMode, isMobileRef, focusedSplitRatioRef });

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

  const { layoutReady, onReady } = useWorkspaceLayout({
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
    setOpenBookIds: setOpenBookIdsStable,
  });

  // Sync books to context ref so NewTabPanel (and other consumers) can read them.
  // Done in an effect so it happens after commit, not during render.
  useEffect(() => {
    ws.booksRef.current = books;
  }, [books, ws]);

  // Expose the authoritative open-book set to context consumers (e.g. the chat
  // book-selector). `openBookIds` already accounts for focused mode, where
  // inactive clusters are unmounted. Consumers re-read it on cluster changes.
  useEffect(() => {
    ws.openBookIdsRef.current = openBookIds;
    ws.notifyClusterChanges();
  }, [openBookIds, ws]);

  // Register TOC change listener (safe to re-run when ws changes)
  useEffect(() => {
    ws.tocChangeListener.current = () => setTocVersion((v) => v + 1);
    return () => {
      ws.tocChangeListener.current = null;
    };
  }, [ws]);

  useWorkspaceShortcuts({ apiRef, collapsed, zenMode, updateSettings });

  useEffect(() => {
    const prevZenMode = prevZenModeRef.current;
    if (prevZenMode === zenMode) return;

    prevZenModeRef.current = zenMode;

    if (zenMode) {
      const api = apiRef.current;
      zenPreStateRef.current = {
        sidebarCollapsed: collapsedRef.current,
        readerLayout: readerLayoutRef.current,
        dockviewJson: api?.toJSON(),
      };

      if (api) {
        for (const panel of Array.from(api.panels)) {
          if (!panel.id.startsWith("book-")) api.removePanel(panel);
        }
      }

      updateSettings({ sidebarCollapsed: true, readerLayout: "spread" });
      setTimeout(
        () => queueMicrotask(() => window.dispatchEvent(new Event("resize"))),
        SIDEBAR_TRANSITION_MS,
      );
      return;
    }

    const previous = zenPreStateRef.current;
    if (!previous) return;

    updateSettings({
      sidebarCollapsed: previous.sidebarCollapsed,
      readerLayout: previous.readerLayout,
      zenMode: false,
    });

    if (previous.dockviewJson) {
      try {
        apiRef.current?.fromJSON(previous.dockviewJson);
      } catch (err) {
        console.error("Failed to restore zen mode dockview layout:", err);
      }
    }

    queueMicrotask(() => window.dispatchEvent(new Event("resize")));
    zenPreStateRef.current = null;
  }, [zenMode, updateSettings]);

  const {
    openBook,
    openNotebook,
    openChat,
    openBookmarks,
    openReadingHistory,
    openStandardEbooks,
    closeBookPanels,
  } = useWorkspacePanels({
    apiRef,
    ws,
    isMobileRef,
    collapsedRef,
    layoutModeRef,
    focusedClustersRef,
    focusedOrderRef,
    updateSettings,
  });

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
      closeBookPanels(bookId);
      updateBooks((prev) => prev.filter((b) => b.id !== bookId));
    },
    [closeBookPanels, updateBooks],
  );

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });

  // Sync context refs so child panels can open books/notebooks/chats and trigger uploads.
  useEffect(() => {
    ws.openBookRef.current = openBook;
    ws.openNotebookRef.current = openNotebook;
    ws.openChatRef.current = openChat;
    ws.openBookmarksRef.current = openBookmarks;
    ws.openStandardEbooksRef.current = openStandardEbooks;
    ws.onBookAddedRef.current = handleBookAdded;
    ws.onBookDeletedRef.current = handleBookDeleted;
  }, [
    handleBookAdded,
    handleBookDeleted,
    openBook,
    openBookmarks,
    openChat,
    openNotebook,
    openStandardEbooks,
    ws,
  ]);

  useEffect(() => {
    return () => {
      ws.openBookRef.current = null;
      ws.openNotebookRef.current = null;
      ws.openChatRef.current = null;
      ws.openBookmarksRef.current = null;
      ws.openStandardEbooksRef.current = null;
      ws.onBookAddedRef.current = null;
      ws.onBookDeletedRef.current = null;
    };
  }, [ws]);

  const sidebarProps = {
    collapsed,
    sortBy,
    layoutMode,
    openBooks,
    otherBooks,
    getClusterEntries,
    getActiveClusterId,
    onUpdateSettings: updateSettings,
    onOpenBook: (book: BookMeta) => {
      openBook(book);
      setMobileOpen(false);
    },
    onOpenChat: (book: BookMeta) => {
      openChat(book);
      setMobileOpen(false);
    },
    onOpenNotebook: (book: BookMeta) => {
      openNotebook(book);
      setMobileOpen(false);
    },
    onOpenBookmarks: (book: BookMeta) => {
      openBookmarks(book);
      setMobileOpen(false);
    },
    onOpenReadingHistory: (book: BookMeta) => {
      openReadingHistory(book);
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
          { "zen-mode": zenMode },
        )}
      >
        {/* Desktop sidebar — hidden on mobile */}
        {isMobile !== true && !zenMode && <WorkspaceSidebar {...sidebarProps} />}

        {/* Mobile floating pill + sheet sidebar */}
        {isMobile === true && !zenMode && (
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
          {layoutMode === "focused" && !zenMode && (
            <ClusterBar
              getEntries={getClusterEntries}
              getActiveId={getActiveClusterId}
              onActivate={(bookId) => ws.setActiveCluster(bookId)}
              onClose={closeFocusedCluster}
              onReorder={reorderFocusedClusters}
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
