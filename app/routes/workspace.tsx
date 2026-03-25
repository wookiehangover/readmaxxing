import { useState, useCallback, useRef, useEffect, useMemo, type ChangeEvent } from "react";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type IWatermarkPanelProps,
  type DockviewTheme,
} from "dockview";
import { BookOpen, NotebookPen, Plus, ArrowUpDown } from "lucide-react";
import { BookCover, TocList } from "~/components/book-list";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { Route } from "./+types/workspace";
import { BookService, type Book } from "~/lib/book-store";
import { parseEpubEffect } from "~/lib/epub-service";
import { DropZone } from "~/components/drop-zone";
import type { TocEntry } from "~/lib/reader-context";
import { WorkspaceService } from "~/lib/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings, type WorkspaceSortBy } from "~/lib/settings";
import { useEffectQuery } from "~/lib/use-effect-query";
import { cn } from "~/lib/utils";
import { WorkspaceBookReader } from "~/components/workspace-book-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Reader" },
    { name: "description", content: "Multi-pane book workspace" },
  ];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(
    BookService.pipe(Effect.andThen((s) => s.getBooks())),
  );
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
const notebookCallbackMap = new Map<string, (attrs: { highlightId: string; cfiRange: string; text: string }) => void>();
// Listeners notified when tocMap changes (so React can re-render)
let tocChangeListener: (() => void) | null = null;
// Module-level ref to the top-level DockviewApi for cross-panel operations
let dockviewApiRef: DockviewApi | null = null;

// Helpers to look up panel-keyed maps by bookId
function findNavForBook(bookId: string): ((cfi: string) => void) | undefined {
  const dockApi = dockviewApiRef;
  if (!dockApi) return undefined;
  for (const panel of dockApi.panels) {
    if (panel.id.startsWith("book-") && (panel.params as Record<string, unknown>)?.bookId === bookId) {
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
    if (panel.id.startsWith("book-") && (panel.params as Record<string, unknown>)?.bookId === bookId) {
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
}: IDockviewPanelProps<{ bookId: string; bookTitle?: string }>) {
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

  return (
    <WorkspaceBookReader
      bookId={params.bookId}
      panelApi={api}
      onRegisterNavigation={handleRegister}
      onUnregisterNavigation={handleUnregister}
      onRegisterToc={handleRegisterToc}
      onUnregisterToc={handleUnregisterToc}
      onOpenNotebook={handleOpenNotebook}
      onHighlightCreated={handleHighlightCreated}
    />
  );
}

function NotebookPanel({
  params,
}: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      findNavForBook(params.bookId)?.(cfi);
    },
    [params.bookId],
  );

  const handleRegisterAppendHighlight = useCallback(
    (bookId: string, fn: (attrs: { highlightId: string; cfiRange: string; text: string }) => void) => {
      notebookCallbackMap.set(bookId, fn);
    },
    [],
  );

  const handleUnregisterAppendHighlight = useCallback(
    (bookId: string) => {
      notebookCallbackMap.delete(bookId);
    },
    [],
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

const components: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = {
  "book-reader": BookReaderPanel,
  notebook: NotebookPanel,
};

// --- Empty state watermark ---

function WatermarkPanel(_props: IWatermarkPanelProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <BookOpen className="mx-auto mb-3 size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No tabs open</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a book from the sidebar to get started
        </p>
      </div>
    </div>
  );
}

function WorkspaceSidebarBookContent({
  book,
  collapsed,
}: {
  book: Book;
  collapsed: boolean;
}) {
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

  const handleOpenChange = useCallback(
    (nextOpen: boolean, details: { reason: string }) => {
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
    },
    [],
  );

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
        // After the sidebar CSS transition completes (200ms), notify dockview
        // and epub renditions that the container dimensions changed.
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 220);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, updateSettings]);

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
        (p) => p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
      );
      if (existing) {
        existing.focus();
        return;
      }
    }

    const panelId = `book-${book.id}-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "book-reader",
      title: truncateTitle(book.title),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
    });
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

    api.addPanel({
      id: panelId,
      component: "notebook",
      title: truncateTitle(`Notes: ${book.title}`),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
    });
  }, []);

  const handleBookAdded = useCallback((book: Book) => {
    setBooks((prev) => [...prev, book]);
  }, []);

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
        } catch (err) {
          console.error("Failed to add book:", err);
        }
      }
      // Reset input so the same file can be re-selected
      e.target.value = "";
    },
    [],
  );

  return (
    <DropZone onBookAdded={handleBookAdded}>
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside
        className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out ${
          collapsed ? "w-14" : "w-[300px]"
        }`}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          {!collapsed && <h1 className="text-lg font-semibold">Books</h1>}
          <div className="flex items-center gap-1">
            {!collapsed && (
              <div className="relative">
                <ArrowUpDown className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={sortBy}
                  onChange={(e) => updateSettings({ workspaceSortBy: e.target.value as WorkspaceSortBy })}
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Add books"
            >
              <Plus className="size-4" />
            </button>
          </div>
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
            !collapsed && (
              <p className="p-4 text-sm text-muted-foreground">
                No books yet. Drop an epub or click + to add.
              </p>
            )
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
                        collapsed={collapsed}
                        toc={bookToc}
                        onOpenBook={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                        isOpen={openBookIds.has(book.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => openBook(book, e.metaKey || e.ctrlKey)}
                        className={cn(
                          "flex w-full items-center rounded-md text-left hover:bg-accent",
                          {
                            "justify-center p-1.5": collapsed,
                            "gap-3 px-3 py-2": !collapsed,
                            "bg-accent/50": openBookIds.has(book.id),
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
            </ul>
          )}
        </ScrollArea>
      </aside>

      {/* Dockview container */}
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
