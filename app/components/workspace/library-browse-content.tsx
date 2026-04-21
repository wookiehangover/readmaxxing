import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { DockviewPanelApi } from "dockview";
import { Button } from "~/components/ui/button";
import {
  MessageSquare,
  NotebookPen,
  Ellipsis,
  Globe,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { CoverImage } from "~/components/book-grid/cover-image";
import { CoverPlaceholder } from "~/components/book-grid/cover-placeholder";
import { AddBookCard } from "~/components/book-grid/add-book-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { LibraryToolbar } from "~/components/workspace/library-toolbar";
import { LibraryTable } from "~/components/workspace/library-table";
import { type BookMeta, bookNeedsDownload } from "~/lib/stores/book-store";
import { useBookUpload } from "~/hooks/use-book-upload";
import { useBookDeletion } from "~/hooks/use-book-deletion";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useSyncState } from "~/lib/sync/use-sync";
import { useSettings } from "~/lib/settings";
import { filterBooks } from "~/lib/workspace-utils";

interface LibraryBrowseContentProps {
  /** Dockview panel API — when provided, enables visibility-based refresh. */
  panelApi?: DockviewPanelApi;
}

/** Minimum interval between panel-activation-triggered refreshes (ms). */
const PANEL_REFRESH_THROTTLE_MS = 5000;

export function LibraryBrowseContent({ panelApi }: LibraryBrowseContentProps = {}) {
  const ws = useWorkspace();
  const [books, setBooks] = useState<BookMeta[]>(ws.booksRef.current);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings] = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastRefreshedAtRef = useRef(0);

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
    },
    [ws],
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

  const { handleDeleteBook } = useBookDeletion({ onBookDeleted: handleBookDeleted });
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
          new CustomEvent("sync:entity-updated", { detail: { entity: "book" } }),
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
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
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
          <LibraryToolbar query={searchQuery} onQueryChange={setSearchQuery} />
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
                {filteredBooks.map((book) => {
                  const needsDownload = bookNeedsDownload(book);
                  return (
                    <div key={book.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => handleOpenBook(book)}
                        className="block w-full text-left"
                      >
                        <div className="relative overflow-hidden rounded-lg shadow-sm transition-shadow group-hover:shadow-md">
                          {book.coverImage || book.remoteCoverUrl ? (
                            <CoverImage
                              coverImage={book.coverImage}
                              alt={book.title}
                              remoteCoverUrl={book.remoteCoverUrl}
                              bookId={book.id}
                              needsDownload={needsDownload}
                            />
                          ) : (
                            <CoverPlaceholder title={book.title} author={book.author} />
                          )}
                        </div>
                        <p className="mt-2 truncate text-sm font-medium">{book.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
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
                          {syncActive && (
                            <DropdownMenuItem onClick={() => handleReloadBook(book.id)}>
                              <RefreshCw className="size-4" />
                              Sync
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => handleDeleteBook(book.id)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
    </div>
  );
}
