import { useEffect } from "react";
import { Effect } from "effect";
import { toast } from "sonner";
import { useSyncListener } from "~/hooks/use-sync-listener";
import { AppRuntime } from "~/lib/effect-runtime";
import { isFurtherAlong } from "~/lib/position-compare";
import { getRemotePositionRecord } from "~/lib/stores/remote-position-store";
import { ReadingPositionService } from "~/lib/stores/position-store";

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

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    void (async () => {
      try {
        const [remote, local] = await Promise.all([
          getRemotePositionRecord(bookId),
          AppRuntime.runPromise(
            ReadingPositionService.pipe(Effect.andThen((s) => s.getPositionRecord(bookId))),
          ),
        ]);
        if (cancelled || !remote || !local) return;
        if (remote.updatedAt <= local.updatedAt) return;
        if (!isFurtherAlong(remote.cfi, local.cfi)) return;

        const recordKey = `${bookId}:${remote.updatedAt}`;
        if (shownRemoteRecords.has(recordKey)) return;
        shownRemoteRecords.add(recordKey);

        toast("You were further along on another device", {
          action: {
            label: "Go to furthest position",
            onClick: () => navigateToPosition(remote.cfi),
          },
        });
      } catch (error) {
        console.warn("Failed to check remote reading position:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId, enabled, navigateToPosition, positionSyncVersion]);
}