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
import { clampFocusedSplitRatio, useSettings } from "~/lib/settings";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { sortBooks } from "~/lib/workspace-utils";
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
  // Track which books have TOC data via a version counter (triggers re-render)
  const [_tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());

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
    setOpenBookIds,
  });

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

  useWorkspaceShortcuts({ apiRef, collapsed, updateSettings });

  const { openBook, openNotebook, openChat, openStandardEbooks, closeBookPanels } =
    useWorkspacePanels({
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
    ws.openStandardEbooksRef.current = openStandardEbooks;
    ws.onBookAddedRef.current = handleBookAdded;
    ws.onBookDeletedRef.current = handleBookDeleted;
  }, [
    handleBookAdded,
    handleBookDeleted,
    openBook,
    openChat,
    openNotebook,
    openStandardEbooks,
    ws,
  ]);

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
