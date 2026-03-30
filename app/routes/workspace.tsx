import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type DockviewTheme,
  type AddPanelPositionOptions,
} from "dockview";
import { PanelLeft, X } from "lucide-react";
import type { Route } from "./+types/workspace";
import { BookService, type BookMeta } from "~/lib/book-store";
import { useBookUpload } from "~/lib/use-book-upload";
import { DropZone } from "~/components/drop-zone";
import { WorkspaceService } from "~/lib/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings } from "~/lib/settings";
import { useEffectQuery } from "~/lib/use-effect-query";
import { truncateTitle, sortBooks } from "~/lib/workspace-utils";
import { cn } from "~/lib/utils";
import { WorkspaceProvider, useWorkspace } from "~/lib/workspace-context";
import { BookReaderPanel, NotebookPanel, ChatPanel } from "~/components/workspace/panel-components";
import { NewTabPanel } from "~/components/workspace/new-tab-panel";
import { StandardEbooksPanel } from "~/components/workspace/standard-ebooks-panel";
import { WatermarkPanel } from "~/components/workspace/watermark-panel";
import { LeftHeaderActions } from "~/components/workspace/left-header-actions";
import { WorkspaceSidebar } from "~/components/workspace/workspace-sidebar";
import { useIsMobile } from "~/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";

/** Delay after sidebar CSS transition before dispatching resize (ms) */
const SIDEBAR_TRANSITION_MS = 270;
/** Debounce delay for persisting dockview layout changes (ms) */
const LAYOUT_SAVE_DEBOUNCE_MS = 500;

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
  const sortBy = settings.workspaceSortBy;
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposablesRef = useRef<Array<{ dispose: () => void }>>([]);
  // Sync books to context ref so NewTabPanel can read them
  ws.booksRef.current = books;
  // Track which books have TOC data via a version counter (triggers re-render)
  const [_tocVersion, setTocVersion] = useState(0);
  // Track which books currently have open panels in dockview
  const [openBookIds, setOpenBookIds] = useState<Set<string>>(new Set());
  // Track total panel count for dynamic document title
  const [panelCount, setPanelCount] = useState(0);
  // Track whether dockview layout has been restored (controls fade-in)
  const [layoutReady, setLayoutReady] = useState(false);

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

  // Flush layout to IndexedDB immediately (non-debounced)
  const flushLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const layout = api.toJSON();
    AppRuntime.runPromise(WorkspaceService.pipe(Effect.andThen((s) => s.saveLayout(layout)))).catch(
      console.error,
    );
  }, []);

  // Debounced layout save
  const saveLayout = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushLayout, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [flushLayout]);

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
          setLayoutReady(true);
        })
        .catch((err) => {
          console.error(err);
          setLayoutReady(true);
        });

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
      // In dockview v5, onDidLayoutChange does not fire for panel add/remove/move,
      // so we must also listen to those events to persist layout changes.
      disposablesRef.current = [
        event.api.onDidAddPanel(updatePanelCount),
        event.api.onDidRemovePanel(updatePanelCount),
        event.api.onDidAddPanel(updateOpenBooks),
        event.api.onDidRemovePanel(updateOpenBooks),
        event.api.onDidAddPanel(saveLayout),
        event.api.onDidRemovePanel(saveLayout),
        event.api.onDidMovePanel(saveLayout),
        event.api.onDidLayoutChange(saveLayout),
      ];
    },
    [saveLayout, ws],
  );

  // Flush pending layout save on page unload / tab hide
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        flushLayout();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushLayout]);

  // Register TOC change listener (safe to re-run when ws changes)
  useEffect(() => {
    ws.tocChangeListener.current = () => setTocVersion((v) => v + 1);
    return () => {
      ws.tocChangeListener.current = null;
    };
  }, [ws]);

  // Cleanup dockview disposables and maps only on unmount —
  // these must NOT be disposed on context value changes, because
  // onReady only registers them once per mount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      ws.navigationMap.current.clear();
      ws.tocMap.current.clear();
      ws.notebookCallbackMap.current.clear();
      ws.tempHighlightMap.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const openBook = useCallback((book: BookMeta, forceNew = false) => {
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
    const isFirstPanel = !api.panels.some((p) => p.id.startsWith("book-"));

    const panelId = `book-${book.id}-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "book-reader",
      title: truncateTitle(book.title),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
    });

    // When opening the first panel on a wide screen (and not mobile), add a companion chat panel
    if (isFirstPanel && !isMobileRef.current && window.innerWidth > 1000) {
      const chatId = `chat-${book.id}`;
      api.addPanel({
        id: chatId,
        component: "chat",
        title: truncateTitle(`Chat: ${book.title}`),
        params: { bookId: book.id, bookTitle: book.title },
        renderer: "always",
        position: { referencePanel: panelId, direction: "right" },
      });
    }
  }, []);

  const openNotebook = useCallback((book: BookMeta) => {
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

    // On mobile, open as a tab in the same group (no split); on desktop, split right
    let position: AddPanelPositionOptions | undefined;
    if (!isMobileRef.current && bookPanel) {
      const bookGroup = bookPanel.group;
      const bookRect = bookGroup.element.getBoundingClientRect();
      // Look for an existing group whose left edge is to the right of the book's group
      const rightGroup = api.groups.find(
        (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
      );
      if (rightGroup) {
        // Add as a tab in the existing right group
        position = { referenceGroup: rightGroup };
      } else {
        // No group to the right — split to create one
        position = { referencePanel: bookPanel.id, direction: "right" as const };
      }
    }

    api.addPanel({
      id: panelId,
      component: "notebook",
      title: truncateTitle(`Notes: ${book.title}`),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
      ...(position ? { position } : {}),
    });
  }, []);

  const openStandardEbooks = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.panels.find((p) => p.id.startsWith("standard-ebooks-"));
    if (existing) {
      existing.focus();
      return;
    }
    const panelId = `standard-ebooks-${crypto.randomUUID().slice(0, 8)}`;
    api.addPanel({
      id: panelId,
      component: "standard-ebooks",
      title: "Standard Ebooks",
      params: {},
    });
  }, []);

  const openChat = useCallback((book: BookMeta) => {
    const api = apiRef.current;
    if (!api) return;

    const panelId = `chat-${book.id}`;
    const existing = api.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    // Find an open book panel to position the chat to its right
    const bookPanel = api.panels.find(
      (p) => p.id.startsWith("book-") && (p.params as Record<string, unknown>)?.bookId === book.id,
    );

    // On mobile, open as a tab in the same group (no split); on desktop, split right
    let position: AddPanelPositionOptions | undefined;
    if (!isMobileRef.current && bookPanel) {
      const bookGroup = bookPanel.group;
      const bookRect = bookGroup.element.getBoundingClientRect();
      const rightGroup = api.groups.find(
        (g) => g !== bookGroup && g.element.getBoundingClientRect().left >= bookRect.right - 1,
      );
      if (rightGroup) {
        position = { referenceGroup: rightGroup };
      } else {
        position = { referencePanel: bookPanel.id, direction: "right" as const };
      }
    }

    api.addPanel({
      id: panelId,
      component: "chat",
      title: truncateTitle(`Chat: ${book.title}`),
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
      ...(position ? { position } : {}),
    });
  }, []);

  // Wrap setBooks to also update booksRef and notify booksChangeListener
  const updateBooks = useCallback(
    (updater: (prev: BookMeta[]) => BookMeta[]) => {
      setBooks((prev) => {
        const next = updater(prev);
        ws.booksRef.current = next;
        ws.booksChangeListener.current?.();
        return next;
      });
    },
    [ws],
  );

  const handleBookAdded = useCallback(
    (book: BookMeta) => {
      updateBooks((prev) => [...prev, book]);
      openBook(book);
    },
    [openBook, updateBooks],
  );

  const handleBookDeleted = useCallback(
    (bookId: string) => {
      updateBooks((prev) => prev.filter((b) => b.id !== bookId));
    },
    [updateBooks],
  );

  const { handleFileInput } = useBookUpload({ onBookAdded: handleBookAdded });

  // Sync context refs so child panels can open books/notebooks/chats and trigger uploads
  ws.openBookRef.current = openBook;
  ws.openNotebookRef.current = openNotebook;
  ws.openChatRef.current = openChat;
  ws.openStandardEbooksRef.current = openStandardEbooks;
  ws.onBookAddedRef.current = handleBookAdded;
  ws.onBookDeletedRef.current = handleBookDeleted;

  const sidebarProps = {
    collapsed,
    sortBy,
    openBooks,
    otherBooks,
    onUpdateSettings: updateSettings,
    onOpenBook: (book: BookMeta, forceNew?: boolean) => {
      openBook(book, forceNew);
      setMobileOpen(false);
    },
    onOpenNotebook: (book: BookMeta) => {
      openNotebook(book);
      setMobileOpen(false);
    },
    onOpenNewTab: () => {
      openNewTab();
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
              className="fixed top-2 right-2 z-[60] flex items-center justify-center rounded-full border border-border/50 bg-card/80 p-2 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-card hover:text-foreground active:bg-accent"
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
