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
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "~/components/ui/sidebar";

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
      title: `Notes: ${book.title}`,
      params: { bookId: book.id, bookTitle: book.title },
      renderer: "always",
    });
  }, []);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link to="/" />} tooltip="Back to Library">
                <Library data-icon="inline-start" />
                <span className="font-semibold">Books</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              {books.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No books yet. Drop an epub file on the library page.
                </p>
              ) : (
                <SidebarMenu>
                  {books.map((book) => (
                    <SidebarMenuItem key={book.id} className="group/book">
                      <SidebarMenuButton
                        onClick={() => openBook(book)}
                        tooltip={book.title}
                      >
                        <BookOpen data-icon="inline-start" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{book.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{book.author}</p>
                        </div>
                      </SidebarMenuButton>
                      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5 opacity-0 group-hover/book:opacity-100">
                        <button
                          type="button"
                          onClick={() => openBook(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          title="Open book"
                        >
                          <BookOpen className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openNotebook(book)}
                          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          title="Open notebook"
                        >
                          <NotebookPen className="size-3.5" />
                        </button>
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="flex flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
        </header>
        <div className="flex-1">
          <DockviewReact
            className={dockviewTheme}
            components={components}
            watermarkComponent={WatermarkPanel}
            onReady={onReady}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
