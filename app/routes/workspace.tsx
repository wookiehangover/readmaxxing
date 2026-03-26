import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type IWatermarkPanelProps,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
} from "dockview";
import {
  BookOpen,
  NotebookPen,
  Plus,
  ArrowUpDown,
  Settings,
  Upload,
  Columns2,
  Ellipsis,
  Trash2,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { BookCover, TocList } from "~/components/book-list";
import { CoverImage, CoverPlaceholder, AddBookCard } from "~/components/book-grid";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { Route } from "./+types/workspace";
import { BookService, type Book } from "~/lib/book-store";
import { useBookUpload } from "~/lib/use-book-upload";
import { useBookDeletion } from "~/lib/use-book-deletion";
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
import { truncateTitle, sortBooks } from "~/lib/workspace-utils";
import { WorkspaceProvider, useWorkspace } from "~/lib/workspace-context";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;
/** Debounce delay for persisting dockview layout changes (ms) */
const LAYOUT_SAVE_DEBOUNCE_MS = 500;

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


// --- Panel components ---

function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<{ bookId: string; bookTitle?: string } & PanelTypographyParams>) {
  const { navigationMap, tocMap, tocChangeListener, dockviewApi, notebookCallbackMap } =
    useWorkspace();

  const handleRegister = useCallback(
    (panelId: string, nav: (cfi: string) => void) => {
      navigationMap.current.set(panelId, nav);
    },
    [navigationMap],
  );

  const handleUnregister = useCallback(
    (panelId: string) => {
      navigationMap.current.delete(panelId);
    },
    [navigationMap],
  );

  const handleRegisterToc = useCallback(
    (panelId: string, toc: TocEntry[]) => {
      tocMap.current.set(panelId, toc);
      tocChangeListener.current?.();
    },
    [tocMap, tocChangeListener],
  );

  const handleUnregisterToc = useCallback(
    (panelId: string) => {
      tocMap.current.delete(panelId);
      tocChangeListener.current?.();
    },
    [tocMap, tocChangeListener],
  );

  const handleOpenNotebook = useCallback(() => {
    const dockApi = dockviewApi.current;
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
  }, [dockviewApi, params.bookId, params.bookTitle, api.id]);

  const handleHighlightCreated = useCallback(
    (highlight: { highlightId: string; cfiRange: string; text: string }) => {
      const appendFn = notebookCallbackMap.current.get(params.bookId);
      if (appendFn) {
        appendFn(highlight);
      }
    },
    [notebookCallbackMap, params.bookId],
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
  const { findNavForBook, notebookCallbackMap } = useWorkspace();

  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      findNavForBook(params.bookId)?.(cfi);
    },
    [findNavForBook, params.bookId],
  );

  const handleRegisterAppendHighlight = useCallback(
    (
      bookId: string,
      fn: (attrs: { highlightId: string; cfiRange: string; text: string }) => void,
    ) => {
      notebookCallbackMap.current.set(bookId, fn);
    },
    [notebookCallbackMap],
  );

  const handleUnregisterAppendHighlight = useCallback(
    (bookId: string) => {
      notebookCallbackMap.current.delete(bookId);
    },
    [notebookCallbackMap],
  );

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
  const ws = useWorkspace();
  const [books, setBooks] = useState<Book[]>(ws.booksRef.current);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Subscribe to book list changes
    const prev = ws.booksChangeListener.current;
    ws.booksChangeListener.current = () => setBooks([...ws.booksRef.current]);
    return () => {
      ws.booksChangeListener.current = prev;
    };
  }, [ws]);

  const handleOpenBook = useCallback(
    (book: Book) => {
      ws.openBookRef.current?.(book);
    },
    [ws],
  );

  const handleOpenNotebook = useCallback(
    (book: Book) => {
      ws.openNotebookRef.current?.(book);
    },
    [ws],
  );

  const handleBookAddedNewTab = useCallback(
    (book: Book) => {
      ws.booksRef.current = [...ws.booksRef.current, book];
      ws.booksChangeListener.current?.();
      ws.openBookRef.current?.(book);
    },
    [ws],
  );

  const handleBookDeletedNewTab = useCallback(
    (bookId: string) => {
      ws.booksRef.current = ws.booksRef.current.filter((b) => b.id !== bookId);
      ws.booksChangeListener.current?.();
    },
    [ws],
  );

  const { handleDeleteBook } = useBookDeletion({ onBookDeleted: handleBookDeletedNewTab });
  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAddedNewTab });

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".epub"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
      {books.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="w-40">
            <AddBookCard onClick={() => fileInputRef.current?.click()} />
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-4 md:p-6">
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
                      <CoverImage coverImage={book.coverImage} alt={book.title} />
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
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenNotebook(book)}>
                      <NotebookPen className="size-4" />
                      Open notebook
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
              <AddBookCard onClick={() => fileInputRef.current?.click()} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const components: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  "book-reader": BookReaderPanel,
  notebook: NotebookPanel,
  "new-tab": NewTabPanel,
};

function LeftHeaderActions({ containerApi }: IDockviewHeaderActionsProps) {
  const handleClick = useCallback(() => {
    const panelId = `new-tab-${crypto.randomUUID().slice(0, 8)}`;
    containerApi.addPanel({
      id: panelId,
      component: "new-tab",
      title: "Library",
      params: {},
    });
  }, [containerApi]);

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        onClick={handleClick}
        className="flex h-full items-center justify-center border-l border-border px-1 text-muted-foreground hover:text-foreground"
        title="New Library tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

// --- Empty state watermark ---

function WatermarkPanel(_props: IWatermarkPanelProps) {
  const { fileInputRef } = useWorkspace();

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

        <h2 className="text-lg font-medium text-foreground">Drop an epub here to start reading</h2>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
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
  const { findNavForBook } = useWorkspace();
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
    [findNavForBook, book.id],
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



const SORT_OPTIONS: { value: WorkspaceSortBy; label: string }[] = [
  { value: "recent", label: "Recently Opened" },
  { value: "title", label: "Title (A–Z)" },
  { value: "author", label: "Author (A–Z)" },
];

export default function WorkspaceRoute({ loaderData }: Route.ComponentProps) {
  return (
    <WorkspaceProvider>
      <WorkspaceRouteInner loaderData={loaderData} />
    </WorkspaceProvider>
  );
}

function WorkspaceRouteInner({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
  const ws = useWorkspace();
  const [books, setBooks] = useState<Book[]>(loaderData.books);
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const sortBy = settings.workspaceSortBy;
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  // Sync books to context ref so NewTabPanel can read them
  ws.booksRef.current = books;
  // Track which books have TOC data via a version counter (triggers re-render)
  const [tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());
  // Track total panel count for dynamic document title
  const [panelCount, setPanelCount] = useState(0);

  // Load last-opened timestamps for sorting
  const { data: lastOpenedMap } = useEffectQuery(
    () => WorkspaceService.pipe(Effect.andThen((s) => s.getLastOpenedMap())),
    [],
  );

  const { openBooks, otherBooks } = useMemo(() => {
    const open: Book[] = [];
    const other: Book[] = [];
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
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      apiRef.current = event.api;
      ws.dockviewApi.current = event.api;

      // Try to restore saved layout
      AppRuntime.runPromise(
        WorkspaceService.pipe(
          Effect.andThen((s) => s.getLayout()),
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
        })
        .catch(console.error);

      // Track total panel count for dynamic title
      const updatePanelCount = () => setPanelCount(event.api.panels.length);
      updatePanelCount();

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

      // Store disposables for cleanup on unmount
      disposablesRef.current = [
        event.api.onDidAddPanel(updatePanelCount),
        event.api.onDidRemovePanel(updatePanelCount),
        event.api.onDidAddPanel(updateOpenBooks),
        event.api.onDidRemovePanel(updateOpenBooks),
        event.api.onDidLayoutChange(() => {
          saveLayout();
        }),
      ];
    },
    [saveLayout, ws],
  );

  // Register TOC change listener and cleanup on unmount
  useEffect(() => {
    ws.tocChangeListener.current = () => setTocVersion((v) => v + 1);
    return () => {
      ws.tocChangeListener.current = null;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      ws.navigationMap.current.clear();
      ws.tocMap.current.clear();
      ws.notebookCallbackMap.current.clear();
    };
  }, [ws]);

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
        }, SIDEBAR_TRANSITION_MS);
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

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });

  // Sync context refs so child panels can open books/notebooks and trigger uploads
  ws.openBookRef.current = openBook;
  ws.openNotebookRef.current = openNotebook;

  return (
    <DropZone onBookAdded={handleBookAdded}>
      <div className="flex h-dvh">
        {/* Sidebar */}
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out",
            { "w-14": collapsed, "w-75": !collapsed },
          )}
        >
          <div className="flex items-center justify-between border-b h-9">
            {!collapsed && (
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
            )}
            {collapsed ? (
              <button
                type="button"
                onClick={() => {
                  updateSettings({ sidebarCollapsed: false });
                  setTimeout(() => {
                    window.dispatchEvent(new Event("resize"));
                  }, SIDEBAR_TRANSITION_MS);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground mx-auto"
                title="Expand sidebar"
              >
                <PanelLeft className="size-4" />
              </button>
            ) : (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => ws.fileInputRef.current?.click()}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Add books"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateSettings({ sidebarCollapsed: true });
                    setTimeout(() => {
                      window.dispatchEvent(new Event("resize"));
                    }, SIDEBAR_TRANSITION_MS);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose className="size-4" />
                </button>
              </div>
            )}
            <input
              ref={ws.fileInputRef}
              type="file"
              accept=".epub"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
          </div>
          <ScrollArea className="min-h-0 flex-1" hideScrollbar>
            {openBooks.length === 0 && otherBooks.length === 0 ? (
              !collapsed && (
                <p className="p-4 text-sm text-muted-foreground">
                  No books yet. Drop an epub or click + to add.
                </p>
              )
            ) : (
              <ul className="flex flex-col gap-0.5 p-1 grayscale hover:grayscale-0 transition-all">
                {/* tocVersion is read here to trigger re-render when TOC data changes */}
                {void tocVersion}
                {openBooks.map((book) => {
                  const bookToc = ws.findTocForBook(book.id);
                  const showTocPopover = bookToc && bookToc.length > 0;

                  return (
                    <li key={book.id} className="group/book relative">
                      {showTocPopover ? (
                        <WorkspaceTocPopoverItem
                          book={book}
                          collapsed={collapsed}
                          toc={bookToc}
                          onOpenBook={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                          isOpen={true}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                          className={cn(
                            "flex w-full items-center rounded-md text-left hover:bg-accent bg-accent/50",
                            {
                              "justify-center p-1.5": collapsed,
                              "gap-3 px-3 py-2": !collapsed,
                            },
                          )}
                          title={book.title}
                        >
                          <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
                        </button>
                      )}
                      {!collapsed && (
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
                      )}
                    </li>
                  );
                })}
                {!collapsed && openBooks.length > 0 && otherBooks.length > 0 && (
                  <li className="my-1 border-b border-border/50" />
                )}
                {!collapsed &&
                  otherBooks.map((book) => {
                    const bookToc = ws.findTocForBook(book.id);
                    const showTocPopover = bookToc && bookToc.length > 0;

                    return (
                      <li key={book.id} className="group/book relative">
                        {showTocPopover ? (
                          <WorkspaceTocPopoverItem
                            book={book}
                            collapsed={collapsed}
                            toc={bookToc}
                            onOpenBook={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                            isOpen={false}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                            className={cn(
                              "flex w-full items-center rounded-md text-left hover:bg-accent",
                              { "gap-3 px-3 py-2": !collapsed },
                            )}
                            title={book.title}
                          >
                            <WorkspaceSidebarBookContent book={book} collapsed={collapsed} />
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
          <div
            className={cn("border-t h-10 flex items-center @container", {
              "justify-between px-1": !collapsed,
              "justify-center": collapsed,
            })}
          >
            <Link
              to="/settings"
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                { "mx-auto": collapsed },
              )}
              title="Settings"
            >
              <Settings className="size-4" />
              {!collapsed && <span>Settings</span>}
            </Link>
            {!collapsed && (
              <button
                type="button"
                onClick={openNewTab}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Open library panel"
              >
                <Plus className="size-4" />
                <span>New tab</span>
              </button>
            )}
          </div>
        </aside>

        {/* Dockview container — full width when sidebar is collapsed */}
        <div className="flex-1">
          <DockviewReact
            theme={dockviewTheme}
            components={components}
            watermarkComponent={WatermarkPanel}
            leftHeaderActionsComponent={LeftHeaderActions}
            onReady={onReady}
          />
        </div>
      </div>
    </DropZone>
  );
}
