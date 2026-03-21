import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { ScrollArea } from "~/components/ui/scroll-area";
import type { Book } from "~/lib/book-store";
import { cn } from "~/lib/utils";

interface BookListProps {
  books: Book[];
  collapsed?: boolean;
}

function BookCover({ coverImage }: { coverImage: Blob }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(coverImage);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [coverImage]);

  if (!url) return null;

  return <img src={url} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />;
}

export function BookList({ books, collapsed = false }: BookListProps) {
  if (books.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        {!collapsed && (
          <>
            <p className="text-sm text-muted-foreground">No books yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Drop an .epub file to get started</p>
          </>
        )}
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className={cn("flex flex-col gap-1", collapsed ? "items-center p-1" : "p-2")}>
        {books.map((book) => (
          <NavLink
            key={book.id}
            to={`/books/${book.id}`}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-lg transition-colors",
                "hover:bg-accent",
                isActive && "bg-accent",
                collapsed ? "justify-center p-1.5" : "gap-3 px-3 py-2 text-left",
              )
            }
          >
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
          </NavLink>
        ))}
      </div>
    </ScrollArea>
  );
}
