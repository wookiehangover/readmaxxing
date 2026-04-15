import { Check, CloudOff, Loader2, AlertTriangle } from "lucide-react";
import { useSyncState } from "~/lib/sync/use-sync";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

function formatLastSynced(iso: string | null): string {
  if (!iso) return "Never synced";
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

/**
 * Minimal sync status indicator for the sidebar footer.
 * Hidden when not authenticated (isActive=false).
 */
export function SyncStatus({ collapsed }: { collapsed: boolean }) {
  const { isSyncing, lastSyncedAt, syncError, isOnline, isActive } = useSyncState();

  if (!isActive) return null;

  let icon: React.ReactNode;
  let label: string;

  if (!isOnline) {
    icon = <CloudOff className="size-3.5" />;
    label = "Offline";
  } else if (syncError) {
    icon = <AlertTriangle className="size-3.5" />;
    label = `Sync error: ${syncError.message}`;
  } else if (isSyncing) {
    icon = <Loader2 className="size-3.5 animate-spin" />;
    label = "Syncing…";
  } else {
    icon = <Check className="size-3.5" />;
    label = `Synced ${formatLastSynced(lastSyncedAt)}`;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
              {
                "text-muted-foreground": !syncError && isOnline,
                "text-destructive": !!syncError,
                "text-yellow-600 dark:text-yellow-500": !isOnline,
              },
            )}
          />
        }
      >
        {icon}
        {!collapsed && (
          <span className="truncate">
            {!isOnline ? "Offline" : syncError ? "Sync error" : isSyncing ? "Syncing…" : "Synced"}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
