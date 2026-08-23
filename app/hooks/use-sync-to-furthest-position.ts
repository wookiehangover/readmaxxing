import { useCallback } from "react";
import { toast } from "sonner";
import { isFurtherAlong } from "~/lib/position-compare";
import {
  getRemotePositionRecord,
  type RemotePositionRecord,
} from "~/lib/stores/remote-position-store";
import { useSyncActions } from "~/lib/sync/use-sync";

type SyncToFurthestOutcome = "jumped" | "already-current" | "nothing-to-sync";

interface SyncToFurthestPositionOptions {
  bookId: string;
  getCurrentPosition: () => string | null;
  navigateToPosition: (position: string) => void;
  pullChanges: () => Promise<void>;
  isOnline?: boolean;
  getRemotePosition?: (bookId: string) => Promise<RemotePositionRecord | null>;
}

export async function syncToFurthestPosition({
  bookId,
  getCurrentPosition,
  navigateToPosition,
  pullChanges,
  isOnline = typeof navigator === "undefined" || navigator.onLine,
  getRemotePosition = getRemotePositionRecord,
}: SyncToFurthestPositionOptions): Promise<SyncToFurthestOutcome> {
  const checkingToast = toast.loading("Checking for furthest page…");
  let usingCache = !isOnline;
  let remotePosition: RemotePositionRecord | null = null;

  try {
    if (isOnline) {
      try {
        await pullChanges();
      } catch {
        usingCache = true;
      }
    }
    remotePosition = await getRemotePosition(bookId);
  } catch {
    usingCache = true;
  } finally {
    toast.dismiss(checkingToast);
  }

  const currentPosition = getCurrentPosition();
  if (!remotePosition || !currentPosition) {
    toast(usingCache ? "No cached reading position to sync." : "Nothing to sync.");
    return "nothing-to-sync";
  }

  if (!isFurtherAlong(remotePosition.cfi, currentPosition)) {
    toast(
      usingCache
        ? "You're already at the furthest cached page."
        : "You're already at the furthest page.",
    );
    return "already-current";
  }

  navigateToPosition(remotePosition.cfi);
  toast.success(usingCache ? "Synced to furthest cached page." : "Synced to furthest page.");
  return "jumped";
}

interface UseSyncToFurthestPositionOptions {
  bookId: string;
  getCurrentPosition: () => string | null;
  navigateToPosition: (position: string) => void;
}

export function useSyncToFurthestPosition({
  bookId,
  getCurrentPosition,
  navigateToPosition,
}: UseSyncToFurthestPositionOptions): () => Promise<void> {
  const { pullChanges } = useSyncActions();

  return useCallback(async () => {
    await syncToFurthestPosition({
      bookId,
      getCurrentPosition,
      navigateToPosition,
      pullChanges,
    });
  }, [bookId, getCurrentPosition, navigateToPosition, pullChanges]);
}
