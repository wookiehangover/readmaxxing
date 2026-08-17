import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DockviewApi } from "dockview-react";
import { Effect } from "effect";
import { PanelLeft, X } from "lucide-react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Route } from "./+types/app-frame";
import { ClusterBar } from "~/components/workspace/cluster-bar";
import { DropZone } from "~/components/drop-zone";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { WorkspaceSidebar } from "~/components/workspace/workspace-sidebar";
import { useBookUpload } from "~/hooks/use-book-upload";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
import { useEffectQuery } from "~/hooks/use-effect-query";
import {
  useFocusedMode,
  type FocusedCluster,
  type FocusedModeInitialState,
} from "~/hooks/use-focused-mode";
import { useIsMobile } from "~/hooks/use-mobile";
import { useOpenBookChapterUploads } from "~/hooks/use-open-book-chapter-uploads";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useWorkspaceLayout } from "~/hooks/use-workspace-layout";
import {
  clearPendingBookOpenOnWorkspaceExit,
  useWorkspacePanels,
} from "~/hooks/use-workspace-panels";
import { useWorkspaceShortcuts } from "~/hooks/use-workspace-shortcuts";
import { useWorkspace } from "~/lib/context/workspace-context";
import { AppRuntime } from "~/lib/effect-runtime";
import { ensureLocalThenOpen } from "~/lib/library-book-open";
import { hasDemoOnboardingState, isFirstVisit, seedDemo } from "~/lib/onboarding/demo-seed";
import { activateReadingRoute, getBookReadingPath, getReadingBookId } from "~/lib/reading-route";
import { clampFocusedSplitRatio, useSettings } from "~/lib/settings";
import { BookService, bookNeedsDownload, type BookMeta } from "~/lib/stores/book-store";
import { WorkspaceService, type FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import { cn } from "~/lib/utils";
import { sortBooks } from "~/lib/workspace-utils";

function createInitialFocusedState(
  books: BookMeta[],
  state: FocusedWorkspaceState | null,
): FocusedModeInitialState {
  if (!state) return { clusters: new Map(), order: [], activeBookId: null };

  const booksById = new Map(books.map((book) => [book.id, book]));
  const savedById = new Map(state.clusters.map((cluster) => [cluster.bookId, cluster]));
  const clusters = new Map<string, FocusedCluster>();
  const order: string[] = [];

  for (const bookId of state.order) {
    const saved = savedById.get(bookId);
    const book = booksById.get(bookId);
    if (!saved || !book || clusters.has(bookId)) continue;
    clusters.set(bookId, { ...saved, bookTitle: book.title, bookFormat: book.format });
    order.push(bookId);
  }

  return {
    clusters,
    order,
    activeBookId:
      state.activeBookId && clusters.has(state.activeBookId)
        ? state.activeBookId
        : (order[order.length - 1] ?? null),
  };
}

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
  const demoBook = (await isFirstVisit()) ? await seedDemo() : null;
  const [books, focusedState] = await Promise.all([
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((service) => service.getBooks()))),
    AppRuntime.runPromise(
      WorkspaceService.pipe(
        Effect.andThen((service) => service.getFocusedState()),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
    ),
  ]);
  return { books, focusedState, demoBook, demoActive: hasDemoOnboardingState() };
}

clientLoader.hydrate = true as const;

function WorkspaceLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading workspace…</p>
    </div>
  );
}

export function HydrateFallback() {
  return <WorkspaceLoadingOverlay />;
}

export default function AppFrame({ loaderData }: Route.ComponentProps) {
  const ws = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const readingBookId = getReadingBookId(location.pathname);
  const isWorkspaceRoute = readingBookId !== null;
  const isWorkspaceRouteRef = useRef(isWorkspaceRoute);
  isWorkspaceRouteRef.current = isWorkspaceRoute;
  const previousWorkspaceRouteRef = useRef(isWorkspaceRoute);
  const isMobile = useIsMobile();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [books, setBooks] = useState<BookMeta[]>(loaderData.books);
  const [initialFocusedState] = useState(() =>
    createInitialFocusedState(loaderData.books, loaderData.focusedState),
  );
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const zenMode = settings.zenMode;
  const sortBy = settings.workspaceSortBy;
  const apiRef = useRef<DockviewApi | null>(null);
  const pendingClusterActivationRef = useRef<string | null>(null);
  const pendingOpenBookRef = useRef<BookMeta | null>(null);
  const layoutReadyRef = useRef(false);
  const downloadingSidebarBookIdsRef = useRef(new Set<string>());
  const [, setTocVersion] = useState(0);
  const [downloadingSidebarBookIds, setDownloadingSidebarBookIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(
    () => new Set(initialFocusedState.order),
  );

  const setOpenBookIdsStable = useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    (action) => {
      setOpenBookIds((previous) => {
        const next = typeof action === "function" ? action(previous) : action;
        if (next.size === previous.size && [...next].every((id) => previous.has(id))) {
          return previous;
        }
        return next;
      });
    },
    [],
  );

  const focusedSplitRatioRef = useRef(clampFocusedSplitRatio(settings.focusedSplitRatio));
  focusedSplitRatioRef.current = clampFocusedSplitRatio(settings.focusedSplitRatio);

  const {
    focusedClustersRef,
    focusedOrderRef,
    swapInProgressRef,
    closeFocusedCluster,
    reorderFocusedClusters,
    getClusterEntries,
    getActiveClusterId,
    enforceSingleFocusedCluster,
  } = useFocusedMode({
    apiRef,
    isMobileRef,
    focusedSplitRatioRef,
    initialState: initialFocusedState,
  });

  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((service) => service.getLastOpenedMap())),
    [],
  );

  const { openBooks, otherBooks } = useMemo(() => {
    const open: BookMeta[] = [];
    const other: BookMeta[] = [];
    for (const book of books) (openBookIds.has(book.id) ? open : other).push(book);
    open.sort((a, b) => a.title.localeCompare(b.title));
    return { openBooks: open, otherBooks: sortBooks(other, sortBy, lastOpenedMap) };
  }, [books, lastOpenedMap, openBookIds, sortBy]);

  const {
    openBook,
    openNotebook,
    openChat,
    openBookmarks,
    openOutline,
    openReadingHistory,
    openStandardEbooks,
    closeBookPanels,
  } = useWorkspacePanels({
    apiRef,
    ws,
    isMobileRef,
    focusedClustersRef,
    focusedOrderRef,
    pendingOpenBookRef,
    layoutReadyRef,
    isWorkspaceRouteRef,
  });

  const { layoutReady } = useWorkspaceLayout({
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
    pendingOpenBookRef,
    layoutReadyRef,
    openBook,
    getActiveClusterId,
    enforceSingleFocusedCluster,
    updateSettings,
    setOpenBookIds: setOpenBookIdsStable,
  });
  useOpenBookChapterUploads(openBookIds);

  useEffect(() => {
    setMobileOpen(false);
    clearPendingBookOpenOnWorkspaceExit(
      previousWorkspaceRouteRef.current,
      isWorkspaceRoute,
      pendingOpenBookRef,
    );
    previousWorkspaceRouteRef.current = isWorkspaceRoute;
  }, [isWorkspaceRoute, location.pathname]);

  useEffect(() => {
    layoutReadyRef.current = isWorkspaceRoute;
    if (!isWorkspaceRoute || readingBookId === null) return;
    pendingOpenBookRef.current = null;
    activateReadingRoute({
      bookId: readingBookId,
      books,
      activeBookId: ws.activeClusterBookIdRef.current,
      openBook,
      navigate,
    });
  }, [books, isWorkspaceRoute, navigate, openBook, readingBookId, ws]);

  ws.booksRef.current = books;

  useEffect(() => {
    ws.openBookIdsRef.current = openBookIds;
    ws.notifyClusterChanges();
  }, [openBookIds, ws]);

  useEffect(() => {
    ws.tocChangeListener.current = () => setTocVersion((version) => version + 1);
    return () => {
      ws.tocChangeListener.current = null;
    };
  }, [ws]);

  useWorkspaceShortcuts({ apiRef, collapsed, zenMode, updateSettings });

  const demoBootstrapReady = useDemoOnboarding({
    demoBook: loaderData.demoBook,
    layoutReady: isWorkspaceRoute || layoutReady,
    sidebarCollapsed: collapsed,
    updateSettings,
    openBook,
    openChat,
    openNotebook,
  });
  const workspaceReady = loaderData.demoBook ? demoBootstrapReady : isWorkspaceRoute || layoutReady;
  const frameReady = !isWorkspaceRoute || workspaceReady;

  const updateBooks = useCallback(
    (updater: (previous: BookMeta[]) => BookMeta[]) => {
      let next: BookMeta[] | undefined;
      setBooks((previous) => {
        next = updater(previous);
        return next;
      });
      queueMicrotask(() => {
        if (next !== undefined) ws.booksRef.current = next;
        ws.booksChangeListener.current?.();
      });
    },
    [ws],
  );

  const syncVersion = useSyncListener(["book"]);
  useEffect(() => {
    if (syncVersion === 0) return;
    AppRuntime.runPromise(BookService.pipe(Effect.andThen((service) => service.getBooks())))
      .then((freshBooks) => updateBooks(() => freshBooks))
      .catch(console.error);
  }, [syncVersion, updateBooks]);

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      updateBooks((previous) => [...previous, book]);
      openBook(book);
      navigate(getBookReadingPath(book.id));
    },
    [navigate, openBook, updateBooks],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      closeBookPanels(bookId);
      updateBooks((previous) => previous.filter((book) => book.id !== bookId));
    },
    [closeBookPanels, updateBooks],
  );

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });
  const sidebarBooks = useMemo(
    () => sortBooks(books, sortBy, lastOpenedMap),
    [books, lastOpenedMap, sortBy],
  );

  const handleOpenLibrary = useCallback(() => {
    navigate("/library");
    setMobileOpen(false);
  }, [navigate]);

  const handleOpenSidebarBook = useCallback(
    async (book: BookMeta) => {
      const needsDownload = bookNeedsDownload(book);
      if (needsDownload && downloadingSidebarBookIdsRef.current.has(book.id)) return;

      if (needsDownload) {
        downloadingSidebarBookIdsRef.current.add(book.id);
        setDownloadingSidebarBookIds(new Set(downloadingSidebarBookIdsRef.current));
      }

      try {
        await ensureLocalThenOpen(book, {
          refreshBooks: (freshBooks) => updateBooks(() => freshBooks),
          openBook,
        });
        navigate(getBookReadingPath(book.id));
        setMobileOpen(false);
      } catch (error) {
        console.error("Failed to download sidebar book before opening:", error);
        toast.error(`Could not download “${book.title}”. Please try again.`);
      } finally {
        if (needsDownload) {
          downloadingSidebarBookIdsRef.current.delete(book.id);
          setDownloadingSidebarBookIds(new Set(downloadingSidebarBookIdsRef.current));
        }
      }
    },
    [navigate, openBook, updateBooks],
  );

  const handleActivateCluster = useCallback(
    (bookId: string) => {
      if (!isWorkspaceRoute) pendingClusterActivationRef.current = bookId;
      ws.setActiveCluster(bookId);
      navigate(getBookReadingPath(bookId));
    },
    [isWorkspaceRoute, navigate, ws],
  );

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
    books: sidebarBooks,
    openBooks,
    otherBooks,
    downloadingBookIds: downloadingSidebarBookIds,
    getClusterEntries,
    getActiveClusterId,
    onUpdateSettings: updateSettings,
    onOpenLibrary: handleOpenLibrary,
    onOpenBook: handleOpenSidebarBook,
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
    onOpenOutline: (book: BookMeta) => {
      openOutline(book);
      setMobileOpen(false);
    },
    onOpenReadingHistory: (book: BookMeta) => {
      openReadingHistory(book);
      setMobileOpen(false);
    },
    onFileInput: handleFileInput,
  };

  return (
    <>
      {loaderData.demoBook && isWorkspaceRoute && !workspaceReady && <WorkspaceLoadingOverlay />}
      <DropZone onBookAdded={handleBookAdded}>
        <div
          className={cn(
            "flex h-dvh",
            frameReady ? "animate-in fade-in-0 duration-300" : "opacity-0",
          )}
        >
          {!isWorkspaceRoute && isMobile !== true && <WorkspaceSidebar {...sidebarProps} />}
          {!isWorkspaceRoute && isMobile === true && (
            <>
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className={cn(
                  "fixed bottom-12 right-2 z-50 flex items-center justify-center rounded-full border border-border/50 bg-card/80 p-4 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-card hover:text-foreground active:bg-accent",
                  { "z-[60]": mobileOpen },
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
          <div className="flex min-w-0 flex-1 flex-col">
            {!isWorkspaceRoute && (
              <ClusterBar
                demoActive={loaderData.demoActive}
                getEntries={getClusterEntries}
                getActiveId={getActiveClusterId}
                onActivate={handleActivateCluster}
                onClose={closeFocusedCluster}
                onReorder={reorderFocusedClusters}
              />
            )}
            <div className="min-h-0 flex-1">
              <Outlet />
            </div>
          </div>
        </div>
      </DropZone>
    </>
  );
}
