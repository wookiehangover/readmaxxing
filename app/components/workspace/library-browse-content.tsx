import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { DockviewPanelApi } from "dockview";
import { Effect } from "effect";
import { Button } from "~/components/ui/button";
import {
  MessageSquare,
  NotebookPen,
  Ellipsis,
  Globe,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
  Edit3Icon,
} from "lucide-react";
import { toast } from "sonner";
import { CoverImage } from "~/components/book-grid/cover-image";
import { CoverPlaceholder } from "~/components/book-grid/cover-placeholder";
import { AddBookCard } from "~/components/book-grid/add-book-card";
import { ShareDialog } from "~/components/share-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { LibraryToolbar } from "~/components/workspace/library-toolbar";
import { LibraryTable } from "~/components/workspace/library-table";
import { type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { useBookUpload } from "~/hooks/use-book-upload";
import { useBookDeletion } from "~/hooks/use-book-deletion";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useSyncState } from "~/lib/sync/use-sync";
import { useSettings, type WorkspaceSortBy } from "~/lib/settings";
import { filterBooks, sortBooks } from "~/lib/workspace-utils";
import { useAuth } from "~/lib/context/auth-context";
import { useEffectQuery } from "~/hooks/use-effect-query";
import { Link } from "react-router";

interface LibraryBrowseContentProps {
  /** Dockview panel API — when provided, enables visibility-based refresh. */
  panelApi?: DockviewPanelApi;
}

/** Minimum interval between panel-activation-triggered refreshes (ms). */
const PANEL_REFRESH_THROTTLE_MS = 5000;
const LIBRARY_SORT_STORAGE_KEY = "library-sort-by";
const DEFAULT_LIBRARY_SORT_BY: WorkspaceSortBy = "author";

function isWorkspaceSortBy(value: string | null): value is WorkspaceSortBy {
  return value === "author" || value === "title" || value === "recent";
}

function getStoredLibrarySortBy(): WorkspaceSortBy {
  if (typeof window === "undefined") return DEFAULT_LIBRARY_SORT_BY;
  try {
    const value = localStorage.getItem(LIBRARY_SORT_STORAGE_KEY);
    return isWorkspaceSortBy(value) ? value : DEFAULT_LIBRARY_SORT_BY;
  } catch {
    return DEFAULT_LIBRARY_SORT_BY;
  }
}

function saveLibrarySortBy(sortBy: WorkspaceSortBy): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIBRARY_SORT_STORAGE_KEY, sortBy);
  } catch {
    // Ignore storage failures and keep the in-memory selection for this session.
  }
}

export function LibraryBrowseContent({ panelApi }: LibraryBrowseContentProps = {}) {
  const ws = useWorkspace();
  const { isAuthenticated } = useAuth();
  const [books, setBooks] = useState<BookMeta[]>(ws.booksRef.current);
  const [searchQuery, setSearchQuery] = useState("");
  const [librarySortBy, setLibrarySortBy] = useState<WorkspaceSortBy>(() =>
    getStoredLibrarySortBy(),
  );
  const [shareBook, setShareBook] = useState<BookMeta | null>(null);
  const [settings] = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRefreshedAtRef = useRef(0);
  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())),
    [],
  );

  useEffect(() => {
    const prev = ws.booksChangeListener.current;
    ws.booksChangeListener.current = () => setBooks([...ws.booksRef.current]);
    return () => {
      ws.booksChangeListener.current = prev;
    };
  }, [ws]);

  const handleOpenBook = useCallback(
    (book: BookMeta) => {
      ws.openBookRef.current?.(book);
      if (settings.layoutMode === "focused") {
        panelApi?.close();
      }
    },
    [panelApi, settings.layoutMode, ws],
  );

  const handleOpenNotebook = useCallback(
    (book: BookMeta) => {
      ws.openNotebookRef.current?.(book);
    },
    [ws],
  );

  const handleOpenChat = useCallback(
    (book: BookMeta) => {
      ws.openChatRef.current?.(book);
    },
    [ws],
  );

  const handleShareBook = useCallback((book: BookMeta) => {
    if (!book.remoteFileUrl) {
      toast.warning("Sign in and sync this book before sharing it.");
      return;
    }
    setShareBook(book);
  }, []);

  const handleLibrarySortByChange = useCallback((sortBy: WorkspaceSortBy) => {
    setLibrarySortBy(sortBy);
    saveLibrarySortBy(sortBy);
  }, []);

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      ws.onBookAddedRef.current?.(book);
    },
    [ws],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      ws.onBookDeletedRef.current?.(bookId);
    },
    [ws],
  );

  const { handleDeleteBook } = useBookDeletion({
    onBookDeleted: handleBookDeleted,
  });
  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });
  const { reloadBookFiles, isActive: syncActive, triggerSync } = useSyncState();

  const handleReloadBook = useCallback(
    async (bookId: string) => {
      try {
        await reloadBookFiles(bookId);
      } catch (err) {
        console.error("Failed to reload book:", err);
      }
    },
    [reloadBookFiles],
  );

  // When the library panel becomes visible/active in dockview, trigger a
  // sync and refresh the book list (throttled to avoid thrashing on rapid
  // panel switching). Dispatching `sync:entity-updated` {book} piggybacks
  // on the workspace's existing listener which calls BookService.getBooks
  // and propagates the result through booksRef + booksChangeListener.
  useEffect(() => {
    if (!panelApi) return;

    const refreshLibrary = () => {
      const now = Date.now();
      if (now - lastRefreshedAtRef.current < PANEL_REFRESH_THROTTLE_MS) return;
      lastRefreshedAtRef.current = now;

      if (syncActive) triggerSync();

      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", {
            detail: { entity: "book" },
          }),
        );
      });
    };

    const visDisposable = panelApi.onDidVisibilityChange((e) => {
      if (e.isVisible) refreshLibrary();
    });
    const activeDisposable = panelApi.onDidActiveChange((e) => {
      if (e.isActive) refreshLibrary();
    });

    return () => {
      visDisposable.dispose();
      activeDisposable.dispose();
    };
  }, [panelApi, syncActive, triggerSync]);

  const filteredBooks = useMemo(
    () => (searchQuery ? filterBooks(books, searchQuery) : books),
    [books, searchQuery],
  );
  const sortedGridBooks = useMemo(
    () => sortBooks(filteredBooks, librarySortBy, lastOpenedMap),
    [filteredBooks, librarySortBy, lastOpenedMap],
  );

  const libraryView = settings.libraryView;
  const isEmpty = books.length === 0;
  const hasMatches = filteredBooks.length > 0;

  return (
    <div className="flex h-full flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub,.pdf"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      {isEmpty ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="max-w-md space-y-3 text-sm text-muted-foreground">
            <p>
              Readmaxxing is an AI-assisted reading app with chat, search, notes, bookmarks, and
              history built into your workspace.
            </p>
            <p>
              Use it for syntopical reading, comparative literature, and interrogating multiple
              books at once.
            </p>
            <p>Open a book to start reading, mark up ideas, and build context as you go.</p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            Upload an epub or PDF
          </Button>
          <span className="text-sm text-muted-foreground">or</span>
          <Button variant="outline" onClick={() => ws.openStandardEbooksRef.current?.()}>
            <Globe className="size-4" />
            Browse Standard Ebooks
          </Button>
        </div>
      ) : (
        <>
          <LibraryToolbar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            sortBy={librarySortBy}
            onSortByChange={handleLibrarySortByChange}
          />
          {!hasMatches ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-sm text-muted-foreground">No matching books</p>
            </div>
          ) : libraryView === "table" ? (
            <div className="flex-1 overflow-hidden p-4 pt-2 md:p-6 md:pt-3">
              <LibraryTable
                books={filteredBooks}
                onOpenBook={handleOpenBook}
                onOpenNotebook={handleOpenNotebook}
                onOpenChat={handleOpenChat}
                onDeleteBook={handleDeleteBook}
                onReloadBook={handleReloadBook}
                syncActive={syncActive}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 pt-2 md:p-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {sortedGridBooks.map((book) => {
                  return (
                    <LibraryBook
                      key={book.id}
                      book={book}
                      handleOpenBook={handleOpenBook}
                      handleOpenNotebook={handleOpenNotebook}
                      handleOpenChat={handleOpenChat}
                      handleDeleteBook={handleDeleteBook}
                      handleReloadBook={handleReloadBook}
                      handleShareBook={handleShareBook}
                      isAuthenticated={isAuthenticated}
                      syncActive={syncActive}
                    />
                  );
                })}
                <div>
                  <AddBookCard onClick={() => fileInputRef.current?.click()} />
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => ws.openStandardEbooksRef.current?.()}
                    className="flex aspect-[2/3] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
                  >
                    <Globe className="size-6" />
                    <span className="text-xs font-medium">Standard Ebooks</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      <ShareDialog
        book={shareBook}
        open={shareBook !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setShareBook(null);
        }}
      />
    </div>
  );
}

function LibraryBook({
  book,
  handleOpenBook,
  handleOpenNotebook,
  handleOpenChat,
  handleDeleteBook,
  handleReloadBook,
  handleShareBook,
  isAuthenticated,
  syncActive,
}: {
  book: BookMeta;
  handleOpenBook: (book: BookMeta) => void;
  handleOpenNotebook: (book: BookMeta) => void;
  handleOpenChat: (book: BookMeta) => void;
  handleDeleteBook: (bookId: BookMeta["id"]) => void;
  handleReloadBook: (bookId: BookMeta["id"]) => void;
  handleShareBook: (book: BookMeta) => void;
  isAuthenticated: boolean;
  syncActive: boolean;
}) {
  const needsDownload = bookNeedsDownload(book);

  return (
    <div key={book.id} className="group relative">
      <button type="button" onClick={() => handleOpenBook(book)} className="block w-full text-left">
        <div className="relative shadow-lg transition-shadow duration-500 book-cover-container group-hover:shadow-2xl">
          {book.coverImage || book.remoteCoverUrl ? (
            <CoverImage
              coverImage={book.coverImage}
              alt={book.title}
              remoteCoverUrl={book.remoteCoverUrl}
              bookId={book.id}
              updatedAt={book.updatedAt}
              needsDownload={needsDownload}
            />
          ) : (
            <CoverPlaceholder title={book.title} author={book.author} />
          )}
        </div>
        {/*<p className="mt-2 truncate text-sm font-medium">{book.title}</p>*/}
        {/*<p className="truncate text-xs text-muted-foreground">{book.author}</p>*/}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="ml-auto flex size-7 items-center justify-center rounded-md text-foreground/70 backdrop-blur-sm transition-opacity hover:bg-background focus-visible:opacity-100 mt-1"
          render={<button type="button" />}
          onClick={(e) => e.preventDefault()}
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuItem onClick={() => handleOpenNotebook(book)}>
            <NotebookPen className="size-4" />
            Open notebook
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleOpenChat(book)}>
            <MessageSquare className="size-4" />
            Open chat
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to={`/books/${book.id}/details`} />}>
            <Edit3Icon className="size-4" />
            Edit
          </DropdownMenuItem>
          {isAuthenticated && (
            <DropdownMenuItem onClick={() => handleShareBook(book)}>
              <Share2 className="size-4" />
              Share
            </DropdownMenuItem>
          )}
          {syncActive && (
            <DropdownMenuItem onClick={() => handleReloadBook(book.id)}>
              <RefreshCw className="size-4" />
              Sync
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => handleDeleteBook(book.id)}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
