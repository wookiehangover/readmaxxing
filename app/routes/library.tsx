import { useState, useCallback } from "react";
import { Outlet } from "react-router";
import type { Route } from "./+types/library";
import { getBooks, type Book } from "~/lib/book-store";
import { DropZone } from "~/components/drop-zone";
import { BookList } from "~/components/book-list";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "eBook Reader" },
    { name: "description", content: "A browser-based ebook reader" },
  ];
}

export async function clientLoader() {
  const books = await getBooks();
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

  const handleBookAdded = useCallback((book: Book) => {
    setBooks((prev) => [...prev, book]);
  }, []);

  return (
    <DropZone onBookAdded={handleBookAdded}>
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r bg-card">
          <div className="border-b px-4 py-3">
            <h1 className="text-lg font-semibold">Library</h1>
          </div>
          <BookList books={books} />
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </DropZone>
  );
}

