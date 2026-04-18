import type { BookMeta } from "~/lib/stores/book-store";
import type { WorkspaceSortBy } from "~/lib/settings";

export function truncateTitle(title: string, maxLength = 30): string {
  return title.length > maxLength ? title.slice(0, maxLength) + "…" : title;
}

export function sortBooks(
  books: BookMeta[],
  sortBy: WorkspaceSortBy,
  lastOpenedMap: Map<string, number> | undefined,
): BookMeta[] {
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

export function filterBooks(books: BookMeta[], query: string): BookMeta[] {
  const q = query.toLowerCase();
  return books.filter(
    (book) =>
      book.title.toLowerCase().includes(q) ||
      (book.author && book.author.toLowerCase().includes(q)),
  );
}

export type TableSortColumn = "title" | "author" | "format" | "lastOpened" | "updated";
export type SortDirection = "asc" | "desc";

export function sortBooksForTable(
  books: BookMeta[],
  column: TableSortColumn,
  direction: SortDirection,
  lastOpenedMap: Map<string, number> | undefined,
): BookMeta[] {
  const sorted = [...books];
  const dir = direction === "asc" ? 1 : -1;
  switch (column) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title) * dir);
      break;
    case "author":
      sorted.sort((a, b) => a.author.localeCompare(b.author) * dir);
      break;
    case "format":
      sorted.sort((a, b) => (a.format ?? "").localeCompare(b.format ?? "") * dir);
      break;
    case "lastOpened": {
      const map = lastOpenedMap ?? new Map<string, number>();
      sorted.sort((a, b) => {
        const ta = map.get(a.id) ?? 0;
        const tb = map.get(b.id) ?? 0;
        // Never-opened (0) sink to bottom regardless of direction.
        if (ta === 0 && tb === 0) return 0;
        if (ta === 0) return 1;
        if (tb === 0) return -1;
        return (ta - tb) * dir;
      });
      break;
    }
    case "updated": {
      sorted.sort((a, b) => {
        const ta = a.updatedAt ?? 0;
        const tb = b.updatedAt ?? 0;
        // Missing updatedAt (0) sink to bottom regardless of direction.
        if (ta === 0 && tb === 0) return 0;
        if (ta === 0) return 1;
        if (tb === 0) return -1;
        return (ta - tb) * dir;
      });
      break;
    }
  }
  return sorted;
}
