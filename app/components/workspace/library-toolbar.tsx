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
    <div className="flex w-full min-w-0 items-center gap-3 px-4 md:px-6">
      <div className="relative min-w-0 max-w-sm flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search library"
          className="h-8 pl-7 text-sm border-none placeholder:text-muted-foreground/50"
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
