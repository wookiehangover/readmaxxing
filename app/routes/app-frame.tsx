import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import type { DockviewApi } from "dockview-react";
import { Outlet, useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/app-frame";
import { DropZone } from "~/components/drop-zone";
import { LibraryFrame } from "~/components/workspace/library-frame";
import { useBookUpload } from "~/hooks/use-book-upload";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
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
import { activateReadingRoute, getBookReadingPath, getReadingBookId } from "~/lib/reading-route";
import { clampFocusedSplitRatio, useSettings } from "~/lib/settings";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import type { FocusedWorkspaceState } from "~/lib/stores/workspace-store";
import { useAppStore } from "~/lib/themis/provider";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { cn } from "~/lib/utils";

export function createInitialFocusedState(
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
  const books = await BookService.getBooks();
  return { books };
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

export function WorkspaceRestoreGate({ children }: PropsWithChildren) {
  const store = useAppStore();
  const workspaceRestoreLoading =
    store.workspaceRestoreSelectors.selectWorkspaceRestoreLoading.useValue();
  const booksLoading = store.booksSelectors.selectBooksLoading.useValue();
  return workspaceRestoreLoading || booksLoading ? <WorkspaceLoadingOverlay /> : children;
}

export default function AppFrame() {
  return (
    <WorkspaceRestoreGate>
      <AppFrameContent />
    </WorkspaceRestoreGate>
  );
}

function AppFrameContent() {
  const ws = useWorkspace();
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();
  const focusedWorkspace = store.workspaceRestoreSelectors.selectFocusedWorkspace.useValue();
  const seededDemoBookId = store.booksSelectors.selectSeededDemoBookId.useValue();
  const demoBook = store.booksSelectors.selectBookById.useValue(seededDemoBookId ?? "") ?? null;
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
  const [initialFocusedState] = useState(() => createInitialFocusedState(books, focusedWorkspace));
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const zenMode = settings.zenMode;
  const apiRef = useRef<DockviewApi | null>(null);
  const pendingClusterActivationRef = useRef<string | null>(null);
  const pendingOpenBookRef = useRef<BookMeta | null>(null);
  const layoutReadyRef = useRef(false);
  const [, setTocVersion] = useState(0);
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
    getActiveClusterId,
    enforceSingleFocusedCluster,
  } = useFocusedMode({
    apiRef,
    isMobileRef,
    focusedSplitRatioRef,
    initialState: initialFocusedState,
  });

  const { openBook, openNotebook, openChat, openBookmarks, openStandardEbooks, closeBookPanels } =
    useWorkspacePanels({
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

  // Deprecated compatibility mirror for out-of-scope chat consumers.
  // The slice remains the source of truth for migrated book UI.
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
    demoBook,
    layoutReady: isWorkspaceRoute || layoutReady,
    sidebarCollapsed: collapsed,
    updateSettings,
    openBook,
    openChat,
    openNotebook,
  });
  const workspaceReady = demoBook ? demoBootstrapReady : isWorkspaceRoute || layoutReady;
  const frameReady = !isWorkspaceRoute || workspaceReady;

  const syncVersion = useSyncListener(["book"]);
  useEffect(() => {
    if (syncVersion === 0) return;
    store.dispatch(hydrateBooks());
  }, [store, syncVersion]);

  const handleUploadedBookAdded = useCallback(
    (book: BookMeta) => {
      openBook(book);
      navigate(getBookReadingPath(book.id));
    },
    [navigate, openBook],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      closeBookPanels(bookId);
    },
    [closeBookPanels],
  );

  const { handleFileInput } = useBookUpload({ onBookAdded: handleUploadedBookAdded });

  useEffect(() => {
    ws.openBookRef.current = openBook;
    ws.openNotebookRef.current = openNotebook;
    ws.openChatRef.current = openChat;
    ws.openBookmarksRef.current = openBookmarks;
    ws.openStandardEbooksRef.current = openStandardEbooks;
    ws.onBookAddedRef.current = handleUploadedBookAdded;
    ws.onBookDeletedRef.current = handleBookDeleted;
  }, [
    handleBookDeleted,
    handleUploadedBookAdded,
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

  return (
    <>
      {demoBook && isWorkspaceRoute && !workspaceReady && <WorkspaceLoadingOverlay />}
      <DropZone onBookAdded={handleUploadedBookAdded}>
        <div
          className={cn("flex h-dvh", {
            "animate-in fade-in-0 duration-300": frameReady,
            "opacity-0": !frameReady,
          })}
        >
          {isWorkspaceRoute ? (
            <div className="min-h-0 min-w-0 flex-1">
              <Outlet />
            </div>
          ) : (
            <LibraryFrame fileInputRef={ws.fileInputRef} onFileInput={handleFileInput}>
              <Outlet />
            </LibraryFrame>
          )}
        </div>
      </DropZone>
    </>
  );
}
