import { ArrowDownAZ, ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { WorkspaceSortBy } from "~/lib/settings";

const sortOptions: readonly { value: WorkspaceSortBy; label: string }[] = [
  { value: "author", label: "Author" },
  { value: "title", label: "Title" },
  { value: "recent", label: "Recent" },
];

interface LibrarySortControlProps {
  readonly sortBy: WorkspaceSortBy;
  readonly onSortByChange: (sortBy: WorkspaceSortBy) => void;
}

export function LibrarySortControl({ sortBy, onSortByChange }: LibrarySortControlProps) {
  const current = sortOptions.find((option) => option.value === sortBy) ?? sortOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            title={`Sort by ${current.label}`}
          />
        }
        aria-label={`Sort library by ${current.label}`}
      >
        <ArrowDownAZ data-icon="inline-start" />
        <span>{current.label}</span>
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sortBy}
            onValueChange={(value) => onSortByChange(value as WorkspaceSortBy)}
          >
            {sortOptions.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
