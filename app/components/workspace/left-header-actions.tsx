import { useCallback } from "react";
import { Plus } from "lucide-react";
import { useWorkspace } from "~/lib/context/workspace-context";

export function LeftHeaderActions() {
  const ws = useWorkspace();
  const handleClick = useCallback(() => {
    ws.setActiveCluster(null);
  }, [ws]);

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        onClick={handleClick}
        className="flex h-full items-center justify-center border-l border-border px-1 text-muted-foreground hover:text-foreground"
        title="New Library tab"
        aria-label="New Library tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
