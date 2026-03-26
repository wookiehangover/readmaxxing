import type { Book } from "~/lib/book-store";
import type { WorkspaceSortBy } from "~/lib/settings";

export function truncateTitle(title: string, maxLength = 30): string {
  return title.length > maxLength ? title.slice(0, maxLength) + "…" : title;
}

export function sortBooks(
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
