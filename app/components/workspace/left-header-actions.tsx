import { useCallback } from "react";
import type { IDockviewHeaderActionsProps } from "dockview";
import { Plus } from "lucide-react";
import { useSettings } from "~/lib/settings";
import { useWorkspace } from "~/lib/context/workspace-context";

export function LeftHeaderActions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const [settings] = useSettings();
  const ws = useWorkspace();
  const handleClick = useCallback(() => {
    if (settings.layoutMode === "focused") {
      ws.setActiveCluster(null);
      return;
    }

    const panelId = `new-tab-${crypto.randomUUID().slice(0, 8)}`;
    containerApi.addPanel({
      id: panelId,
      component: "new-tab",
      title: "Library",
      params: {},
      position: { referenceGroup: group },
    });
  }, [containerApi, group, settings.layoutMode, ws]);

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
