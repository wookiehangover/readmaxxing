import { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { Menu, PanelsTopLeft, Settings } from "lucide-react";
import type { Route } from "./+types/library";
import { useSettings } from "~/lib/settings";
import { DropZone } from "~/components/drop-zone";
import { BookList } from "~/components/book-list";
import { ThemeToggle } from "~/components/theme-toggle";
import { ReaderNavigationProvider } from "~/lib/context/reader-context";
import { useIsMobile } from "~/hooks/use-mobile";
import { hydrateBooks } from "~/lib/themis/books/books-slice";
import { useAppStore } from "~/lib/themis/provider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "~/components/ui/sheet";

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

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading library…</p>
    </div>
  );
}

export default function LibraryLayout() {
  const store = useAppStore();
  const books = store.booksSelectors.selectAllBooks.useValue();
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Reload books when sync pulls book data
  const syncVersion = useSyncListener(["book"]);
  useEffect(() => {
    if (syncVersion === 0) return;
    store.dispatch(hydrateBooks());
  }, [store, syncVersion]);

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
      <DropZone>
        <div className="flex h-dvh animate-in fade-in-0 duration-300">
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
