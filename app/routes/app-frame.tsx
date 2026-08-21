import { useCallback, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/app-frame";
import { DropZone } from "~/components/drop-zone";
import { LibraryFrame } from "~/components/workspace/library-frame";
import { useBookUpload } from "~/hooks/use-book-upload";
import { useDemoOnboarding } from "~/hooks/use-demo-onboarding";
import { useOpenBookChapterUploads } from "~/hooks/use-open-book-chapter-uploads";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useWorkspacePanels } from "~/hooks/use-workspace-panels";
import { useWorkspaceShortcuts } from "~/hooks/use-workspace-shortcuts";
import { useWorkspace } from "~/lib/context/workspace-context";
import { activateReadingRoute, getReadingBookId } from "~/lib/reading-route";
import { useSettings } from "~/lib/settings";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { useAppStore } from "~/lib/themis/provider";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { cn } from "~/lib/utils";

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
  const booksLoading = store.booksSelectors.selectBooksLoading.useValue();
  return booksLoading ? <WorkspaceLoadingOverlay /> : children;
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
  const seededDemoBookId = store.booksSelectors.selectSeededDemoBookId.useValue();
  const demoBook = store.booksSelectors.selectBookById.useValue(seededDemoBookId ?? "") ?? null;
  const location = useLocation();
  const navigate = useNavigate();
  const readingBookId = getReadingBookId(location.pathname);
  const isWorkspaceRoute = readingBookId !== null;
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const zenMode = settings.zenMode;
  const [, setTocVersion] = useState(0);

  const { openBook, openNotebook, openChat, openBookmarks, openStandardEbooks, closeBookPanels } =
    useWorkspacePanels();
  const openBookIds = useMemo(
    () => new Set(readingBookId === null ? [] : [readingBookId]),
    [readingBookId],
  );
  useOpenBookChapterUploads(openBookIds);

  useEffect(() => {
    if (readingBookId === null) {
      ws.setActiveCluster(null);
      return;
    }
    activateReadingRoute({
      bookId: readingBookId,
      books,
      activeBookId: ws.activeClusterBookIdRef.current,
      openBook,
      navigate,
    });
  }, [books, navigate, openBook, readingBookId, ws]);

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

  useWorkspaceShortcuts({ collapsed, zenMode, updateSettings });

  const demoBootstrapReady = useDemoOnboarding({
    demoBook,
    layoutReady: true,
    sidebarCollapsed: collapsed,
    updateSettings,
    openBook,
    openChat,
    openNotebook,
  });
  const workspaceReady = demoBook ? demoBootstrapReady : true;
  const frameReady = !isWorkspaceRoute || workspaceReady;

  const syncVersion = useSyncListener(["book"]);
  useEffect(() => {
    if (syncVersion === 0) return;
    store.dispatch(hydrateBooks());
  }, [store, syncVersion]);

  const handleUploadedBookAdded = useCallback(
    (book: BookMeta) => {
      openBook(book);
    },
    [openBook],
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
          className={cn("app-frame flex h-dvh", {
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
