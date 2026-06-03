import { Search } from "lucide-react";
import { LibrarySortControl } from "~/components/library-sort-control";
import { Input } from "~/components/ui/input";
import { LibraryViewToggle } from "~/components/workspace/library-view-toggle";
import type { WorkspaceSortBy } from "~/lib/settings";

interface LibraryToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  sortBy: WorkspaceSortBy;
  onSortByChange: (value: WorkspaceSortBy) => void;
}

export function LibraryToolbar({
  query,
  onQueryChange,
  sortBy,
  onSortByChange,
}: LibraryToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 md:px-6">
      <div className="relative flex-1 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search books…"
          className="h-8 pl-7 text-sm"
          aria-label="Search books"
        />
      </div>
      <div className="flex items-center gap-2">
        <LibrarySortControl sortBy={sortBy} onSortByChange={onSortByChange} />
        <LibraryViewToggle />
      </div>
    </div>
  );
}
