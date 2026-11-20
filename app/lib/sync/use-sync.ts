import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useAuth } from "~/lib/context/auth-context";
import { runBlobUrlBackfillIfNeeded } from "./backfill-blob-urls";
import { runFileHashBackfillIfNeeded } from "./backfill-file-hash";
import { runInitialSyncIfNeeded } from "./initial-sync";
import { makeSyncEngine, type SyncEngine } from "./sync-engine";

export interface SyncStatus {
  isSyncing: boolean;
  hasPendingChanges: boolean;
  lastSyncedAt: string | null;
  syncError: Error | null;
  isOnline: boolean;
  isActive: boolean;
}

export interface SyncActions {
  isActive: boolean;
  pullChanges: () => Promise<void>;
  triggerSync: () => Promise<void>;
  reloadBookFiles: (bookId: string) => Promise<void>;
}

export type SyncState = SyncStatus & SyncActions;

const defaultSyncStatus: SyncStatus = {
  isSyncing: false,
  hasPendingChanges: false,
  lastSyncedAt: null,
  syncError: null,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  isActive: false,
};

const defaultSyncActions: SyncActions = {
  isActive: false,
  pullChanges: async () => {},
  triggerSync: async () => {},
  reloadBookFiles: async () => {},
};

let statusSnapshot: SyncStatus = defaultSyncStatus;
const statusListeners = new Set<() => void>();

function emitSyncStatus(partial: Partial<SyncStatus>): void {
  const next: SyncStatus = { ...statusSnapshot, ...partial };
  if (
    next.isSyncing === statusSnapshot.isSyncing &&
    next.hasPendingChanges === statusSnapshot.hasPendingChanges &&
    next.lastSyncedAt === statusSnapshot.lastSyncedAt &&
    next.syncError === statusSnapshot.syncError &&
    next.isOnline === statusSnapshot.isOnline &&
    next.isActive === statusSnapshot.isActive
  ) {
    return;
  }
  statusSnapshot = next;
  for (const listener of statusListeners) listener();
}

function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function getSyncStatusSnapshot(): SyncStatus {
  return statusSnapshot;
}

const SyncActionsContext = createContext<SyncActions>(defaultSyncActions);

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusSnapshot);
}

export function useSyncActions(): SyncActions {
  return useContext(SyncActionsContext);
}

export function useSyncState(): SyncState {
  const status = useSyncStatus();
  const actions = useSyncActions();
  return { ...status, ...actions };
}

export const SyncContext = SyncActionsContext;

export function useSync(): SyncActions {
  const { isAuthenticated, user } = useAuth();
  const engineRef = useRef<SyncEngine | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    emitSyncStatus({ isActive: isAuthenticated });
    if (!isAuthenticated) {
      emitSyncStatus({
        isSyncing: false,
        hasPendingChanges: false,
        syncError: null,
      });
    }
  }, [isAuthenticated]);

  const triggerSync = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Cannot push while offline");
    }
    await engine.triggerManualPush();
  }, []);

  const pullChanges = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Cannot pull while offline");
    }
    await engine.pullChanges();
  }, []);

  const reloadBookFiles = useCallback(async (bookId: string) => {
    if (!engineRef.current) return;
    await engineRef.current.reloadBookFiles(bookId);
    engineRef.current.triggerPush();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      if (engineRef.current) {
        engineRef.current.stopSync();
        engineRef.current = null;
      }
      return;
    }

    const engine = makeSyncEngine({
      userId,
      onSyncStart: () => emitSyncStatus({ isSyncing: true }),
      onSyncEnd: ({ success }) => {
        if (success) {
          emitSyncStatus({
            isSyncing: false,
            hasPendingChanges: false,
            syncError: null,
            lastSyncedAt: new Date().toISOString(),
          });
        } else {
          emitSyncStatus({ isSyncing: false });
        }
      },
      onSyncError: (err) => {
        emitSyncStatus({ syncError: err });
        console.error("[sync]", err.message);
      },
      onAuthExpired: () => {
        engine.stopSync();
        engineRef.current = null;
      },
    });

    engineRef.current = engine;

    runInitialSyncIfNeeded()
      .catch((err) => {
        console.error("[sync] Initial sync scan failed:", err);
      })
      .then(() => runFileHashBackfillIfNeeded())
      .catch((err) => {
        console.error("[sync] File hash backfill failed:", err);
      })
      .then(() => runBlobUrlBackfillIfNeeded())
      .catch((err) => {
        console.error("[sync] Blob URL backfill failed:", err);
      })
      .finally(() => {
        engine.startSync();
      });

    function handleFocus() {
      engineRef.current?.triggerPush();
      engineRef.current?.triggerPull();
    }

    function handleOnline() {
      emitSyncStatus({ isOnline: true });
      engineRef.current?.startSync();
    }

    function handleOffline() {
      emitSyncStatus({ isOnline: false });
      engineRef.current?.stopSync();
    }

    function handlePushNeeded() {
      emitSyncStatus({ hasPendingChanges: true });
      engineRef.current?.triggerPush();
    }

    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("sync:push-needed", handlePushNeeded);

    return () => {
      engine.stopSync();
      engineRef.current = null;
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("sync:push-needed", handlePushNeeded);
    };
  }, [isAuthenticated, userId]);

  return useMemo(
    () => ({
      isActive: isAuthenticated,
      pullChanges,
      triggerSync,
      reloadBookFiles,
    }),
    [isAuthenticated, pullChanges, triggerSync, reloadBookFiles],
  );
}
