import { LayoutGrid, Rows3, Search } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useSettings, type StandardEbooksView } from "~/lib/settings";
import { cn } from "~/lib/utils";

interface StandardEbooksToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
}

export function StandardEbooksToolbar({ query, onQueryChange }: StandardEbooksToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 md:px-6">
      <div className="relative flex-1 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search Standard Ebooks…"
          className="h-8 pl-7 text-sm"
          aria-label="Search Standard Ebooks"
        />
      </div>
      <StandardEbooksViewToggle />
    </div>
  );
}

function StandardEbooksViewToggle() {
  const [settings, updateSettings] = useSettings();
  const current: StandardEbooksView = settings.standardEbooksView;

  return (
    <div className="flex items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Grid view"
        aria-pressed={current === "grid"}
        className={cn("size-7", { "bg-accent text-accent-foreground": current === "grid" })}
        onClick={() => updateSettings({ standardEbooksView: "grid" })}
      >
        <LayoutGrid className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Table view"
        aria-pressed={current === "table"}
        className={cn("size-7", { "bg-accent text-accent-foreground": current === "table" })}
        onClick={() => updateSettings({ standardEbooksView: "table" })}
      >
        <Rows3 className="size-4" />
      </Button>
    </div>
  );
}
