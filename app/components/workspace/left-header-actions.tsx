import { useCallback } from "react";
import type { IDockviewHeaderActionsProps } from "dockview";
import { Plus } from "lucide-react";

export function LeftHeaderActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const handleClick = useCallback(() => {
    const panelId = `new-tab-${crypto.randomUUID().slice(0, 8)}`;
    containerApi.addPanel({
      id: panelId,
      component: "new-tab",
      title: "Library",
      params: {},
      position: { referenceGroup: group },
    });
  }, [containerApi, group]);

  return (
    <div className="flex h-full items-stretch">
      <button
        type="button"
        onClick={handleClick}
        className="flex h-full items-center justify-center border-l border-border px-1 text-muted-foreground hover:text-foreground"
        title="New Library tab"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
