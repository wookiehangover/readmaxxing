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
  /** Whether a sync cycle is currently running. */
  isSyncing: boolean;
  /** Whether there are local changes not yet pushed to the server. */
  hasPendingChanges: boolean;
  /** ISO timestamp of the last successful sync completion. */
  lastSyncedAt: string | null;
  /** Most recent sync error, or null if last sync succeeded. */
  syncError: Error | null;
  /** Whether the browser is online. */
  isOnline: boolean;
  /** Whether the sync engine is active (user is authenticated). */
  isActive: boolean;
}

export interface SyncActions {
  /** Whether the sync engine is active (user is authenticated). */
  isActive: boolean;
  /** Manually trigger a push cycle, including file upload recovery. */
  triggerSync: () => Promise<void>;
  /**
   * Re-download a single book's file and cover, or upload them if the DB
   * row is missing the blob URLs. Also re-uploads extracted chapter text.
   * No-op when the engine is not running.
   */
  reloadBookFiles: (bookId: string) => Promise<void>;
}

/** Combined status + actions. Prefer `useSyncStatus` / `useSyncActions` to avoid extra re-renders. */
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
  triggerSync: async () => {},
  reloadBookFiles: async () => {},
};

/**
 * External store for high-churn sync status (isSyncing, pending, errors).
 * Status flips must not re-render the whole app tree under SyncProvider —
 * only components that call useSyncStatus() subscribe.
 */
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

/** Subscribe to high-churn sync status (syncing spinner, pending badge). */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatusSnapshot, getSyncStatusSnapshot);
}

/** Stable actions + isActive. Does not re-render on isSyncing/pending flips. */
export function useSyncActions(): SyncActions {
  return useContext(SyncActionsContext);
}

/**
 * Combined status + actions. Re-renders on every status flip — prefer
 * useSyncStatus() or useSyncActions() when you only need one side.
 */
export function useSyncState(): SyncState {
  const status = useSyncStatus();
  const actions = useSyncActions();
  return { ...status, ...actions };
}

/** @deprecated Use SyncActionsContext via useSyncActions / useSyncState */
export const SyncContext = SyncActionsContext;

/**
 * React hook that manages the SyncEngine lifecycle.
 *
 * Status is published via an external store so SyncProvider re-renders only
 * when auth/actions change, not on every isSyncing flip.
 */
export function useSync(): SyncActions {
  const { isAuthenticated, user } = useAuth();
  const engineRef = useRef<SyncEngine | null>(null);
  const userId = user?.id ?? null;

  // Keep isActive on the external store in sync with auth without React state.
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
      triggerSync,
      reloadBookFiles,
    }),
    [isAuthenticated, triggerSync, reloadBookFiles],
  );
}
