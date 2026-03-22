import { useState, useCallback, useEffect } from "react";
import { Effect } from "effect";
import { Outlet } from "react-router";
import type { Route } from "./+types/library";
import { BookService, type Book } from "~/lib/book-store";
import { AppRuntime } from "~/lib/effect-runtime";
import { useSettings } from "~/lib/settings";
import { DropZone } from "~/components/drop-zone";
import { BookList } from "~/components/book-list";
import { ReaderNavigationProvider } from "~/lib/reader-context";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "eBook Reader" },
    { name: "description", content: "A browser-based ebook reader" },
  ];
}

export async function clientLoader() {
  const books = await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
  return { books };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-muted-foreground">Loading library…</p>
    </div>
  );
}

export default function LibraryLayout({ loaderData }: Route.ComponentProps) {
  const [books, setBooks] = useState<Book[]>(loaderData.books);
  const [settings, updateSettings] = useSettings();
  const collapsed = settings.sidebarCollapsed;

  const handleBookAdded = useCallback((book: Book) => {
    setBooks((prev) => [...prev, book]);
  }, []);

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
        <div className="flex h-screen">
          {/* Sidebar */}
          <aside
            className={`flex shrink-0 flex-col border-r bg-card transition-[width] duration-200 ease-in-out ${
              collapsed ? "w-14" : "w-[300px]"
            }`}
          >
            <div className="border-b px-4 py-3">
              {!collapsed && <h1 className="text-lg font-semibold">Library</h1>}
            </div>
            <BookList books={books} collapsed={collapsed} />
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </DropZone>
    </ReaderNavigationProvider>
  );
}
