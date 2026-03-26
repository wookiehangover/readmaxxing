import { useState, useCallback, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { Link } from "react-router";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type IWatermarkPanelProps,
  type DockviewTheme,
} from "dockview";
import { BookOpen, NotebookPen, Plus, ArrowUpDown, Settings, Upload, Columns2, Ellipsis, Trash2, FileText } from "lucide-react";
import { BookCover, TocList } from "~/components/book-list";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { Route } from "./+types/workspace";
import { BookService, type Book } from "~/lib/book-store";
import { AnnotationService } from "~/lib/annotations-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { DropZone } from "~/components/drop-zone";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { TocEntry } from "~/lib/reader-context";
import { WorkspaceService } from "~/lib/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings, type WorkspaceSortBy } from "~/lib/settings";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";
import {
  WorkspaceBookReader,
  type PanelTypographyParams,
} from "~/components/workspace-book-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Reader" }, { name: "description", content: "Multi-pane book workspace" }];
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

function truncateTitle(title: string, maxLength = 30): string {
  return title.length > maxLength ? title.slice(0, maxLength) + "…" : title;
}

// --- Navigation & TOC coordination ---
// Map of panelId -> navigateToCfi callback, shared across panels
const navigationMap = new Map<string, (cfi: string) => void>();
// Map of panelId -> TOC entries, populated by WorkspaceBookReader panels
const tocMap = new Map<string, TocEntry[]>();
// Map of bookId -> appendHighlightReference callback, registered by WorkspaceNotebook panels
const notebookCallbackMap = new Map<
  string,
  (attrs: { highlightId: string; cfiRange: string; text: string }) => void
>();
// Listeners notified when tocMap changes (so React can re-render)
let tocChangeListener: (() => void) | null = null;
// Module-level ref to the top-level DockviewApi for cross-panel operations
let dockviewApiRef: DockviewApi | null = null;
// Module-level ref to file input so WatermarkPanel can trigger uploads
let fileInputRefGlobal: React.RefObject<HTMLInputElement | null> | null = null;
// Module-level refs for NewTabPanel: books list and openBook/openNotebook callbacks
let booksRefGlobal: Book[] = [];
let booksChangeListener: (() => void) | null = null;
let openBookGlobal: ((book: Book) => void) | null = null;
let openNotebookGlobal: ((book: Book) => void) | null = null;

// Helpers to look up panel-keyed maps by bookId
function findNavForBook(bookId: string): ((cfi: string) => void) | undefined {
  const dockApi = dockviewApiRef;
  if (!dockApi) return undefined;
  for (const panel of dockApi.panels) {
    if (
      panel.id.startsWith("book-") &&
      (panel.params as Record<string, unknown>)?.bookId === bookId
    ) {
      const nav = navigationMap.get(panel.id);
      if (nav) return nav;
    }
  }
  return undefined;
}

function findTocForBook(bookId: string): TocEntry[] | undefined {
  const dockApi = dockviewApiRef;
  if (!dockApi) return undefined;
  for (const panel of dockApi.panels) {
    if (
      panel.id.startsWith("book-") &&
      (panel.params as Record<string, unknown>)?.bookId === bookId
    ) {
      const toc = tocMap.get(panel.id);
      if (toc && toc.length > 0) return toc;
    }
  }
  return undefined;
}

// --- Panel components ---

function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<{ bookId: string; bookTitle?: string } & PanelTypographyParams>) {
  const handleRegister = useCallback((panelId: string, nav: (cfi: string) => void) => {
    navigationMap.set(panelId, nav);
  }, []);

  const handleUnregister = useCallback((panelId: string) => {
    navigationMap.delete(panelId);
  }, []);

  const handleRegisterToc = useCallback((panelId: string, toc: TocEntry[]) => {
    tocMap.set(panelId, toc);
    tocChangeListener?.();
  }, []);

  const handleUnregisterToc = useCallback((panelId: string) => {
    tocMap.delete(panelId);
    tocChangeListener?.();
  }, []);

  const handleOpenNotebook = useCallback(() => {
    const dockApi = dockviewApiRef;
    if (!dockApi) return;

    const panelId = `notebook-${params.bookId}`;
    const existing = dockApi.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    const title = params.bookTitle ?? "Untitled";
    dockApi.addPanel({
      id: panelId,
      component: "notebook",
      title: truncateTitle(`Notes: ${title}`),
      params: { bookId: params.bookId, bookTitle: title },
      renderer: "always",
      position: { referencePanel: api.id, direction: "right" },
    });
  }, [params.bookId, params.bookTitle]);

  const handleHighlightCreated = useCallback(
    (highlight: { highlightId: string; cfiRange: string; text: string }) => {
      // Look up the notebook's appendHighlightReference callback
      const appendFn = notebookCallbackMap.get(params.bookId);
      if (appendFn) {
        appendFn(highlight);
      }
    },
    [params.bookId],
  );

  // Extract per-panel typography overrides from dockview params (restored layout)
  const panelTypography: PanelTypographyParams = {
    fontFamily: typeof params.fontFamily === "string" ? params.fontFamily : undefined,
    fontSize: typeof params.fontSize === "number" ? params.fontSize : undefined,
    lineHeight: typeof params.lineHeight === "number" ? params.lineHeight : undefined,
    readerLayout:
      typeof params.readerLayout === "string"
        ? (params.readerLayout as PanelTypographyParams["readerLayout"])
        : undefined,
  };

  return (
    <WorkspaceBookReader
      bookId={params.bookId}
      panelApi={api}
      panelTypography={panelTypography}
      onRegisterNavigation={handleRegister}
      onUnregisterNavigation={handleUnregister}
      onRegisterToc={handleRegisterToc}
      onUnregisterToc={handleUnregisterToc}
      onOpenNotebook={handleOpenNotebook}
      onHighlightCreated={handleHighlightCreated}
    />
  );
}

function NotebookPanel({ params }: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      findNavForBook(params.bookId)?.(cfi);
    },
    [params.bookId],
  );

  const handleRegisterAppendHighlight = useCallback(
    (
      bookId: string,
      fn: (attrs: { highlightId: string; cfiRange: string; text: string }) => void,
    ) => {
      notebookCallbackMap.set(bookId, fn);
    },
    [],
  );

  const handleUnregisterAppendHighlight = useCallback((bookId: string) => {
    notebookCallbackMap.delete(bookId);
  }, []);

  return (
    <WorkspaceNotebook
      bookId={params.bookId}
      bookTitle={params.bookTitle}
      onNavigateToCfi={handleNavigateToCfi}
      onRegisterAppendHighlight={handleRegisterAppendHighlight}
      onUnregisterAppendHighlight={handleUnregisterAppendHighlight}
    />
  );
}

function NewTabPanel(_props: IDockviewPanelProps<Record<string, never>>) {
  const [books, setBooks] = useState<Book[]>(booksRefGlobal);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Subscribe to book list changes
    const prev = booksChangeListener;
    booksChangeListener = () => setBooks([...booksRefGlobal]);
    return () => {
      booksChangeListener = prev;
    };
  }, []);

  const handleOpenBook = useCallback((book: Book) => {
    openBookGlobal?.(book);
  }, []);

  const handleOpenNotebook = useCallback((book: Book) => {
    openNotebookGlobal?.(book);
  }, []);

  const handleDeleteBook = useCallback(async (bookId: string) => {
    const confirmed = window.confirm("Are you sure you want to delete this book?");
    if (!confirmed) return;

    const program = Effect.gen(function* () {
      const bookSvc = yield* BookService;
      const annotationSvc = yield* AnnotationService;

      // Delete all highlights for this book
      const highlights = yield* annotationSvc.getHighlightsByBook(bookId);
      for (const hl of highlights) {
        yield* annotationSvc.deleteHighlight(hl.id);
      }

      // Delete the book itself
      yield* bookSvc.deleteBook(bookId);
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("Failed to delete book:", error);
        }),
      ),
    );

    await AppRuntime.runPromise(program);
    booksRefGlobal = booksRefGlobal.filter((b) => b.id !== bookId);
    booksChangeListener?.();
  }, []);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".epub")) continue;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const metadata = await AppRuntime.runPromise(parseEpubEffect(arrayBuffer));
        const book: Book = {
          id: crypto.randomUUID(),
          title: metadata.title,
          author: metadata.author,
          coverImage: metadata.coverImage,
          data: arrayBuffer,
        };
        await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
        // Update the module-level books and notify listeners
        booksRefGlobal = [...booksRefGlobal, book];
        booksChangeListener?.();
        openBookGlobal?.(book);
      } catch (err) {
        console.error("Failed to add book:", err);
      }
    }
    e.target.value = "";
  }, []);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">Library</h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Upload className="size-3.5" />
          Add book
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          multiple
          className="hidden"
          onChange={handleFileInput}
        />
      </div>
      {books.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex flex-col items-center text-center">
            <BookOpen className="mb-3 size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No books yet</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Upload className="size-3.5" />
              Upload an epub
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 md:p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book) => (
              <div key={book.id} className="group relative">
                <button
                  type="button"
                  onClick={() => handleOpenBook(book)}
                  className="block w-full text-left"
                >
                  <div className="overflow-hidden rounded-lg shadow-sm transition-shadow group-hover:shadow-md">
                    {book.coverImage ? (
                      <BookCover coverImage={book.coverImage} />
                    ) : (
                      <div className="flex aspect-[2/3] w-full flex-col items-center justify-center rounded-lg bg-muted p-3 text-center">
                        <BookOpen className="mb-2 size-8 text-muted-foreground/50" />
                        <p className="line-clamp-3 text-sm font-medium text-muted-foreground">
                          {book.title}
                        </p>
                        {book.author && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/70">
                            {book.author}
                          </p>
                        )}
                      </div>
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
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        window.location.href = `/books/${book.id}/details`;
                      }}
                    >
                      <FileText className="size-4" />
                      Details
                    </DropdownMenuItem>
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
            ))}
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-[2/3] w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted"
              >
                <Plus className="mb-2 size-8" />
                <span className="text-sm font-medium">Add book</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const components: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  "book-reader": BookReaderPanel,
  notebook: NotebookPanel,
  "new-tab": NewTabPanel,
};

// --- Empty state watermark ---

function WatermarkPanel(_props: IWatermarkPanelProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-6 flex items-center gap-2 text-muted-foreground/30">
          <div className="flex h-12 w-9 items-center justify-center rounded border border-dashed border-muted-foreground/20">
            <BookOpen className="size-4" />
          </div>
          <Columns2 className="size-3.5" />
          <div className="flex h-12 w-9 items-center justify-center rounded border border-dashed border-muted-foreground/20">
            <BookOpen className="size-4" />
          </div>
        </div>

        <h2 className="text-lg font-medium text-foreground">
          Drop an epub here to start reading
        </h2>

        <button
          type="button"
          onClick={() => fileInputRefGlobal?.current?.click()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Upload className="size-4" />
          Upload an epub
        </button>

        <p className="mt-3 text-xs text-muted-foreground">
          or drag and drop a <span className="font-medium">.epub</span> file anywhere
        </p>
      </div>
    </div>
  );
}

function WorkspaceSidebarBookContent({ book, collapsed }: { book: Book; collapsed: boolean }) {
  return (
    <>
      {book.coverImage ? (
        <BookCover coverImage={book.coverImage} />
      ) : (
        <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted">
          <span className="text-xs text-muted-foreground">📖</span>
        </div>
      )}
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{book.title}</p>
          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
        </div>
      )}
    </>
  );
}

function WorkspaceTocPopoverItem({
  book,
  collapsed,
  toc,
  onOpenBook,
  isOpen,
}: {
  book: Book;
  collapsed: boolean;
  toc: TocEntry[];
  onOpenBook: (e: React.MouseEvent) => void;
  isOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const suppressHoverUntil = useRef(0);

  const handleOpenChange = useCallback((nextOpen: boolean, details: { reason: string }) => {
    if (!nextOpen && (details.reason === "outside-press" || details.reason === "escape-key")) {
      suppressHoverUntil.current = Date.now() + 400;
      setOpen(false);
      return;
    }
    if (nextOpen && details.reason === "trigger-hover") {
      if (Date.now() < suppressHoverUntil.current) {
        return;
      }
    }
    setOpen(nextOpen);
  }, []);

  const handleNavigate = useCallback(
    (href: string) => {
      findNavForBook(book.id)?.(href);
      setOpen(false);
    },
    [book.id],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={300}
        render={
          <button
            type="button"
            onClick={onOpenBook}
            className={`flex w-full items-center rounded-md text-left hover:bg-accent ${
              collapsed ? "justify-center p-1.5" : "gap-3 px-3 py-2"
            } ${isOpen ? "bg-accent/50" : ""}`}
            title={book.title}
          />
        }
      >
        <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="max-h-80 w-56 overflow-y-auto p-1.5"
      >
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Table of Contents</p>
        <ul>
          <TocList entries={toc} onNavigate={handleNavigate} />
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function sortBooks(
  books: Book[],
  sortBy: WorkspaceSortBy,
  lastOpenedMap: Map<string, number> | undefined,
): Book[] {
  const sorted = [...books];
  switch (sortBy) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "author":
      sorted.sort((a, b) => a.author.localeCompare(b.author));
      break;
    case "recent": {
      const map = lastOpenedMap ?? new Map<string, number>();
      sorted.sort((a, b) => {
        const ta = map.get(a.id) ?? 0;
        const tb = map.get(b.id) ?? 0;
        return tb - ta; // most recent first; never-opened (0) sink to bottom
      });
      break;
    }
  }
  return sorted;
}

const SORT_OPTIONS: { value: WorkspaceSortBy; label: string }[] = [
  { value: "recent", label: "Recently Opened" },
  { value: "title", label: "Title (A–Z)" },
  { value: "author", label: "Author (A–Z)" },
];

export default function WorkspaceRoute({ loaderData }: Route.ComponentProps) {
  const [books, setBooks] = useState<Book[]>(loaderData.books);
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const sortBy = settings.workspaceSortBy;
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Expose to module-level so WatermarkPanel and NewTabPanel can trigger uploads
  fileInputRefGlobal = fileInputRef;
  // Sync books to module-level so NewTabPanel can read them
  booksRefGlobal = books;
  // Track which books have TOC data via a version counter (triggers re-render)
  const [tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());
  // Track total panel count for dynamic document title
  const [panelCount, setPanelCount] = useState(0);

  // Hover-reveal state for collapsed sidebar
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSidebarMouseEnter = useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    setSidebarHovered(true);
  }, []);

  const handleSidebarMouseLeave = useCallback(() => {
    hoverLeaveTimerRef.current = setTimeout(() => {
      setSidebarHovered(false);
      hoverLeaveTimerRef.current = null;
    }, 300);
  }, []);

  // Clean up hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
    };
  }, []);

  // Reset hover state when sidebar is pinned open
  useEffect(() => {
    if (!collapsed) setSidebarHovered(false);
  }, [collapsed]);

  // Load last-opened timestamps for sorting
  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())),
    [],
  );

  const sortedBooks = useMemo(
    () => sortBooks(books, sortBy, lastOpenedMap),
    [books, sortBy, lastOpenedMap],
  );

  const dockviewTheme: DockviewTheme = {
    name: "app",
    className: "dockview-theme-app",
  };

  // Debounced layout save
  const saveLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const layout = api.toJSON();
      AppRuntime.runPromise(
        WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(layout))),
      ).catch(console.error);
    }, 500);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      dockviewApiRef = event.api;

      // Try to restore saved layout
      AppRuntime.runPromise(
        WorkspaceService.pipe(
          Effect.andThen((s) => s.getLayout()),
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      )
        .then((layout) => {
          if (layout) {
            event.api.fromJSON(layout);
          }
        })
        .catch(console.error);

      // Track total panel count for dynamic title
      const updatePanelCount = () => setPanelCount(event.api.panels.length);
      updatePanelCount();
      event.api.onDidAddPanel(updatePanelCount);
      event.api.onDidRemovePanel(updatePanelCount);

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

      event.api.onDidAddPanel(updateOpenBooks);
      event.api.onDidRemovePanel(updateOpenBooks);
      updateOpenBooks();

      // Subscribe to layout changes for persistence
      event.api.onDidLayoutChange(() => {
        saveLayout();
      });
    },
    [saveLayout],
  );

  // Register TOC change listener and cleanup on unmount
  useEffect(() => {
    tocChangeListener = () => setTocVersion((v) => v + 1);
    return () => {
      tocChangeListener = null;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      navigationMap.clear();
      tocMap.clear();
      notebookCallbackMap.clear();
    };
  }, []);

  // Update document title with panel count
  useEffect(() => {
    document.title = panelCount > 0 ? `Reader \u2056 ${panelCount}` : "Reader";
  }, [panelCount]);

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
        }, 270);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, updateSettings]);

  const openNewTab = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;

    const panelId = `new-tab-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "new-tab",
      title: "Library",
      params: {},
    });
  }, []);

  const openBook = useCallback((book: Book, forceNew = false) => {
    const api = apiRef.current;
    if (!api) return;

    // Record last-opened timestamp
    AppRuntime.runPromise(
      WorkspaceService.pipe(Effect.andThen((s) => s.saveLastOpened(book.id, Date.now()))),
    ).catch(console.error);

    if (!forceNew) {
      // Focus first existing panel for this book
      const existing = api.panels.find(
        (p) =>
          p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
      );
      if (existing) {
        existing.focus();
        return;
      }
    }

    // Check if this will be the first panel (companion new-tab logic)
    const isFirstPanel = api.panels.length === 0;

    const panelId = `book-${book.id}-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "book-reader",
      title: truncateTitle(book.title),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
    });

    // When opening the first panel, add a companion new-tab panel to its right
    if (isFirstPanel) {
      const newTabId = `new-tab-${crypto.randomUUID().slice(0, 8)}`;
      api.addPanel({
        id: newTabId,
        component: "new-tab",
        title: "Library",
        params: {},
        position: { referencePanel: panelId, direction: "right" },
      });
    }
  }, []);

  const openNotebook = useCallback((book: Book) => {
    const api = apiRef.current;
    if (!api) return;

    const panelId = `notebook-${book.id}`;
    const existing = api.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    // Find an open book panel to position the notebook to its right
    const bookPanel = api.panels.find(
      (p) => p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
    );

    api.addPanel({
      id: panelId,
      component: "notebook",
      title: truncateTitle(`Notes: ${book.title}`),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
      ...(bookPanel
        ? {
            position: {
              referencePanel: bookPanel.id,
              direction: "right" as const,
            },
          }
        : {}),
    });
  }, []);

  const handleBookAdded = useCallback(
    (book: Book) => {
      setBooks((prev) => [...prev, book]);
      openBook(book);
    },
    [openBook],
  );

  const handleFileInput = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (!file.name.endsWith(".epub")) continue;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const metadata = await AppRuntime.runPromise(parseEpubEffect(arrayBuffer));
          const book: Book = {
            id: crypto.randomUUID(),
            title: metadata.title,
            author: metadata.author,
            coverImage: metadata.coverImage,
            data: arrayBuffer,
          };
          await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.saveBook(book))));
          setBooks((prev) => [...prev, book]);
          openBook(book);
        } catch (err) {
          console.error("Failed to add book:", err);
        }
      }
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [openBook],
  );

  // Sync module-level callbacks so NewTabPanel can open books/notebooks
  openBookGlobal = openBook;
  openNotebookGlobal = openNotebook;

  return (
    <DropZone onBookAdded={handleBookAdded}>
      <div className="relative flex h-dvh">
        {/* Hover trigger zone — visible only when sidebar is collapsed */}
        {collapsed && (
          <div
            className="fixed top-0 left-0 z-40 h-full w-3"
            onMouseEnter={handleSidebarMouseEnter}
          />
        )}

        {/* Sidebar */}
        <aside
          onMouseEnter={collapsed ? handleSidebarMouseEnter : undefined}
          onMouseLeave={collapsed ? handleSidebarMouseLeave : undefined}
          className={cn(
            "flex shrink-0 flex-col border-r bg-card transition-transform duration-250 ease-out",
            {
              // Collapsed: fixed overlay, slides offscreen unless hovered
              "fixed top-0 left-0 z-50 h-full w-75 shadow-xl": collapsed,
              "-translate-x-full": collapsed && !sidebarHovered,
              "translate-x-0": collapsed && sidebarHovered,
              // Expanded (pinned): static in layout
              "w-75": !collapsed,
            },
          )}
        >
          <div className="flex items-center justify-between border-b h-9">
            <div className="relative">
              <ArrowUpDown className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <select
                value={sortBy}
                onChange={(e) =>
                  updateSettings({
                    workspaceSortBy: e.target.value as WorkspaceSortBy,
                  })
                }
                className="h-7 appearance-none rounded border-none bg-transparent py-0 pr-2 pl-6 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none"
                title="Sort books"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Add books"
            >
              <Plus className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".epub"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1" hideScrollbar>
            {sortedBooks.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No books yet. Drop an epub or click + to add.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5 p-1 grayscale hover:grayscale-0 transition-all">
                {sortedBooks.map((book) => {
                  // tocVersion is read here to trigger re-render when TOC data changes
                  void tocVersion;
                  const bookToc = findTocForBook(book.id);
                  const showTocPopover = bookToc && bookToc.length > 0;

                  return (
                    <li key={book.id} className="group/book relative">
                      {showTocPopover ? (
                        <WorkspaceTocPopoverItem
                          book={book}
                          collapsed={false}
                          toc={bookToc}
                          onOpenBook={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                          isOpen={openBookIds.has(book.id)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent",
                            {
                              "bg-accent/50": openBookIds.has(book.id),
                            },
                          )}
                          title={book.title}
                        >
                          <WorkspaceSidebarBookContent book={book} collapsed={false} />
                        </button>
                      )}
                      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open book"
                        >
                          <BookOpen className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openNotebook(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Open notebook"
                        >
                          <NotebookPen className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
          <div className="border-t h-10 flex items-center justify-between px-1 @container">
            <Link
              to="/settings"
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Settings"
            >
              <Settings className="size-4" />
              <span>Settings</span>
            </Link>
            <button
              type="button"
              onClick={openNewTab}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open library panel"
            >
              <Plus className="size-4" />
              <span>New tab</span>
            </button>
          </div>
        </aside>

        {/* Dockview container — full width when sidebar is collapsed */}
        <div className="flex-1">
          <DockviewReact
            theme={dockviewTheme}
            components={components}
            watermarkComponent={WatermarkPanel}
            onReady={onReady}
          />
        </div>
      </div>
    </DropZone>
  );
}
