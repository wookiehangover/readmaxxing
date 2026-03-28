import { useState, useCallback, useEffect } from "react";
import { Effect } from "effect";
import { Link, Outlet, useLocation } from "react-router";
import { Menu, PanelsTopLeft, Settings } from "lucide-react";
import type { Route } from "./+types/library";
import { BookService, type BookMeta } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings } from "~/lib/settings";
import { DropZone } from "~/components/drop-zone";
import { BookList } from "~/components/book-list";
import { ThemeToggle } from "~/components/theme-toggle";
import { ReaderNavigationProvider } from "~/lib/reader-context";
import { useIsMobile } from "~/hooks/use-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Reader" }, { name: "description", content: "A browser-based ebook reader" }];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
  return { books };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading library…</p>
    </div>
  );
}

export default function LibraryLayout({ loaderData }: Route.ComponentProps) {
  const [books, setBooks] = useState<BookMeta[]>(loaderData.books);
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const handleBookAdded = useCallback((book: BookMeta) => {
    setBooks((prev) => [...prev, book]);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        updateSettings({ sidebarCollapsed: !collapsed });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [collapsed, updateSettings]);

  return (
    <ReaderNavigationProvider>
      <DropZone onBookAdded={handleBookAdded}>
        <div className="flex h-dvh">
          {/* Desktop sidebar — shown when isMobile is undefined (SSR/initial) or false */}
          {isMobile !== true && (
            <aside
              className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out ${
                collapsed ? "w-14" : "w-[300px]"
              }`}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                {!collapsed && <h1 className="text-lg font-semibold">Library</h1>}
                <Link
                  to="/"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Open Workspace"
                >
                  <PanelsTopLeft className="size-4" />
                </Link>
              </div>
              <BookList books={books} collapsed={collapsed} />
              <div className="flex items-center gap-1 border-t px-2 py-2">
                <ThemeToggle />
                <Link
                  to="/settings"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Settings"
                >
                  <Settings className="size-4" />
                </Link>
              </div>
            </aside>
          )}

          {/* Mobile sidebar sheet — only shown when explicitly determined to be mobile */}
          {isMobile === true && (
            <>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="fixed top-3 left-3 z-40 rounded-md border bg-card p-2 shadow-md"
              >
                <Menu className="size-5" />
              </button>
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>Library</SheetTitle>
                    <SheetDescription className="sr-only">Book library navigation</SheetDescription>
                  </SheetHeader>
                  <BookList books={books} collapsed={false} />
                  <div className="flex items-center gap-1 border-t px-2 py-2">
                    <ThemeToggle />
                    <Link
                      to="/settings"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Settings"
                    >
                      <Settings className="size-4" />
                    </Link>
                  </div>
                </SheetContent>
              </Sheet>
            </>
          )}

          {/* Main content */}
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </DropZone>
    </ReaderNavigationProvider>
  );
}
