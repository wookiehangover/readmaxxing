import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, CloudUpload, Loader2, AlertTriangle } from "lucide-react";
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

/** Force a re-render every 30s so relative timestamps stay fresh. */
function useTimeTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/**
 * Keep error visible for at least `minMs` so it doesn't flicker
 * between error → syncing → error on consecutive failed cycles.
 */
function useStickyError(syncError: Error | null, minMs = 3000): Error | null {
  const [displayError, setDisplayError] = useState<Error | null>(syncError);
  const errorTimestampRef = useRef<number>(0);

  useEffect(() => {
    if (syncError) {
      // New error — show immediately and record the timestamp
      setDisplayError(syncError);
      errorTimestampRef.current = Date.now();
    } else if (displayError) {
      // Error cleared — keep it visible for at least `minMs`
      const elapsed = Date.now() - errorTimestampRef.current;
      const remaining = Math.max(0, minMs - elapsed);
      const timer = setTimeout(() => {
        setDisplayError(null);
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [syncError, minMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return displayError;
}

/**
 * Minimal sync status indicator for the sidebar footer.
 * Hidden when not authenticated (isActive=false).
 */
export function SyncStatus({ collapsed }: { collapsed: boolean }) {
  const { isSyncing, hasPendingChanges, lastSyncedAt, syncError, isOnline, isActive } =
    useSyncState();
  const stickyError = useStickyError(syncError);

  // Keep relative timestamp ("2m ago") updating live
  useTimeTick();

  if (!isActive) return null;

  let icon: React.ReactNode;
  let label: string;
  let shortLabel: string;

  // Priority: offline > error > syncing > pending > synced
  // Use stickyError so the error stays visible long enough to be noticed
  if (!isOnline) {
    icon = <CloudOff className="size-3.5" />;
    label = "Offline";
    shortLabel = "Offline";
  } else if (stickyError) {
    icon = <AlertTriangle className="size-3.5" />;
    label = `Sync error: ${stickyError.message}`;
    shortLabel = "Sync error";
  } else if (isSyncing) {
    icon = <Loader2 className="size-3.5 animate-spin" />;
    label = "Syncing…";
    shortLabel = "Syncing…";
  } else if (hasPendingChanges) {
    icon = <CloudUpload className="size-3.5 animate-pulse" />;
    label = "Pending — local changes not yet synced";
    shortLabel = "Pending";
  } else {
    icon = <Check className="size-3.5" />;
    label = `Synced ${formatLastSynced(lastSyncedAt)}`;
    shortLabel = "Synced";
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
                "text-muted-foreground": !stickyError && isOnline && !hasPendingChanges,
                "text-blue-600 dark:text-blue-400": hasPendingChanges && !stickyError && isOnline,
                "text-destructive": !!stickyError,
                "text-yellow-600 dark:text-yellow-500": !isOnline,
              },
            )}
          />
        }
      >
        {icon}
        {!collapsed && <span className="truncate">{shortLabel}</span>}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
