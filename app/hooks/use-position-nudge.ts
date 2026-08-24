import { useEffect } from "react";
import { toast } from "sonner";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { useAppStore } from "~/lib/themis/provider";
import { checkPositionNudgeRequested } from "~/lib/themis/reading-positions/reading-positions-slice";

const shownRemoteRecords = new Set<string>();

interface UsePositionNudgeConfig {
  bookId: string;
  enabled: boolean;
  navigateToPosition: (cfi: string) => void;
}

export function usePositionNudge({
  bookId,
  enabled,
  navigateToPosition,
}: UsePositionNudgeConfig): void {
  const positionSyncVersion = useSyncListener(["position"]);
  const store = useAppStore();
  const nudge = store.readingPositionsSelectors.selectPositionNudge.useValue(bookId);

  useEffect(() => {
    if (!enabled) return;
    store.dispatch(checkPositionNudgeRequested(bookId));
  }, [bookId, enabled, positionSyncVersion, store]);

  useEffect(() => {
    if (!enabled || !nudge) return;
    const recordKey = `${bookId}:${nudge.updatedAt}`;
    if (shownRemoteRecords.has(recordKey)) return;
    shownRemoteRecords.add(recordKey);
    toast("You were further along on another device", {
      action: {
        label: "Go to furthest position",
        onClick: () => navigateToPosition(nudge.cfi),
      },
    });
  }, [bookId, enabled, navigateToPosition, nudge]);
}
