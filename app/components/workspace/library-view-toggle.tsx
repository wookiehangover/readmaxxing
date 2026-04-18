import { LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useSettings, type LibraryView } from "~/lib/settings";
import { cn } from "~/lib/utils";

export function LibraryViewToggle() {
  const [settings, updateSettings] = useSettings();
  const current: LibraryView = settings.libraryView;

  return (
    <div className="flex items-center">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Grid view"
        aria-pressed={current === "grid"}
        className={cn("size-7", { "bg-accent text-accent-foreground": current === "grid" })}
        onClick={() => updateSettings({ libraryView: "grid" })}
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
        onClick={() => updateSettings({ libraryView: "table" })}
      >
        <Rows3 className="size-4" />
      </Button>
    </div>
  );
}
