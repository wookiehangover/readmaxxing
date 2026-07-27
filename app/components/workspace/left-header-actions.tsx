import { Plus } from "lucide-react";
import { Link } from "react-router";

export function LeftHeaderActions() {
  return (
    <div className="flex h-full items-stretch">
      <Link
        to="/library"
        className="flex h-full items-center justify-center border-l border-border px-1 text-muted-foreground hover:text-foreground"
        title="Open Library"
        aria-label="Open Library"
      >
        <Plus className="size-3.5" />
      </Link>
    </div>
  );
}
