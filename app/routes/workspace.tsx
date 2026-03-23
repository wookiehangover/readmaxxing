import { useState, useCallback, useRef, useEffect } from "react";
import { Effect } from "effect";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type IWatermarkPanelProps,
} from "dockview";
import { Link } from "react-router";
import { BookOpen, NotebookPen, Library } from "lucide-react";
import type { Route } from "./+types/workspace";
import { BookService, type Book } from "~/lib/book-store";
import { WorkspaceService } from "~/lib/workspace-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings } from "~/lib/settings";
import { WorkspaceBookReader } from "~/components/workspace-book-reader";
import { WorkspaceNotebook } from "~/components/workspace-notebook";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Workspace" },
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
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Loading workspace…</p>
    </div>
  );
}

// --- Navigation coordination ---
// Map of bookId -> navigateToCfi callback, shared across panels
const navigationMap = new Map<string, (cfi: string) => void>();

// --- Panel components ---

function BookReaderPanel({
  params,
  api,
}: IDockviewPanelProps<{ bookId: string }>) {
  const handleRegister = useCallback((bookId: string, nav: (cfi: string) => void) => {
    navigationMap.set(bookId, nav);
  }, []);

  const handleUnregister = useCallback((bookId: string) => {
    navigationMap.delete(bookId);
  }, []);

  return (
    <WorkspaceBookReader
      bookId={params.bookId}
      panelApi={api}
      onRegisterNavigation={handleRegister}
      onUnregisterNavigation={handleUnregister}
    />
  );
}

function NotebookPanel({
  params,
}: IDockviewPanelProps<{ bookId: string; bookTitle: string }>) {
  const handleNavigateToCfi = useCallback(
    (cfi: string) => {
      const nav = navigationMap.get(params.bookId);
      nav?.(cfi);
    },
    [params.bookId],
  );

  return (
    <WorkspaceNotebook
      bookId={params.bookId}
      bookTitle={params.bookTitle}
      onNavigateToCfi={handleNavigateToCfi}
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

export default function WorkspaceRoute({ loaderData }: Route.ComponentProps) {
  const [books] = useState<Book[]>(loaderData.books);
  const [settings] = useSettings();
  const apiRef = useRef<DockviewApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dockviewTheme = "dockview-theme-app";

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

      // Subscribe to layout changes for persistence
      event.api.onDidLayoutChange(() => {
        saveLayout();
      });
    },
    [saveLayout],
  );

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      navigationMap.clear();
    };
  }, []);

  const openBook = useCallback((book: Book) => {
    const api = apiRef.current;
    if (!api) return;

    const panelId = `book-${book.id}`;
    const existing = api.panels.find((p) => p.id === panelId);
    if (existing) {
      existing.focus();
      return;
    }

    api.addPanel({
      id: panelId,
      component: "book-reader",
      title: book.title,
      params: { bookId: book.id, bookTitle: book.title },
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
      title: `Notes: ${book.title}`,
      params: { bookId: book.id, bookTitle: book.title },
    });
  }, []);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-semibold">Books</h1>
          <Link
            to="/"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Back to Library"
          >
            <Library className="size-4" />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          {books.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No books yet. Drop an epub file on the library page.
            </p>
          ) : (
            <ul className="space-y-1 p-2">
              {books.map((book) => (
                <li key={book.id}>
                  <div className="group flex items-center gap-1 rounded px-3 py-2 hover:bg-accent">
                    <button
                      type="button"
                      onClick={() => openBook(book)}
                      className="min-w-0 flex-1 text-left text-sm"
                    >
                      <p className="truncate font-medium">{book.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                    </button>
                    <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openBook(book)}
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
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Dockview container */}
      <div className="flex-1">
        <DockviewReact
          className={dockviewTheme}
          components={components}
          watermarkComponent={WatermarkPanel}
          onReady={onReady}
        />
      </div>
    </div>
  );
}
