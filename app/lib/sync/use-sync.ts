import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "~/lib/context/auth-context";
import { runInitialSyncIfNeeded } from "./initial-sync";
import { makeSyncEngine, type SyncEngine } from "./sync-engine";

export interface SyncState {
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
  /** Manually trigger a push+pull cycle. */
  triggerSync: () => void;
}

const defaultSyncState: SyncState = {
  isSyncing: false,
  hasPendingChanges: false,
  lastSyncedAt: null,
  syncError: null,
  isOnline: true,
  isActive: false,
  triggerSync: () => {},
};

const SyncContext = createContext<SyncState>(defaultSyncState);

export function useSyncState(): SyncState {
  return useContext(SyncContext);
}

export { SyncContext };

/**
 * React hook that manages the SyncEngine lifecycle.
 *
 * - Creates and starts the engine when the user is authenticated
 * - Stops the engine on logout or unmount
 * - Triggers a push on window focus
 * - Pauses/resumes based on navigator.onLine
 */
export function useSync(): SyncState {
  const { isAuthenticated, user } = useAuth();
  const engineRef = useRef<SyncEngine | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<Error | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  // Stable trigger function
  const triggerSync = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.triggerPush();
    }
  }, []);

  // Log sync errors to console
  useEffect(() => {
    if (syncError) {
      console.error("[sync]", syncError.message);
    }
  }, [syncError]);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      // Not authenticated (or user not yet loaded) — tear down any existing engine
      if (engineRef.current) {
        engineRef.current.stopSync();
        engineRef.current = null;
      }
      return;
    }

    // Create and start the sync engine
    const engine = makeSyncEngine({
      userId,
      onSyncStart: () => setIsSyncing(true),
      onSyncEnd: ({ success }) => {
        setIsSyncing(false);
        if (success) {
          setHasPendingChanges(false);
          setSyncError(null);
          setLastSyncedAt(new Date().toISOString());
        }
        // On failure: keep hasPendingChanges, syncError, and lastSyncedAt unchanged
      },
      onSyncError: (err) => {
        setSyncError(err);
      },
      onAuthExpired: () => {
        // Session expired — stop syncing; auth context will update separately
        engine.stopSync();
        engineRef.current = null;
      },
    });

    engineRef.current = engine;

    // Run initial sync for existing users before starting the engine.
    // This scans all IDB stores and creates change-log entries for
    // pre-existing data so it gets pushed on the first sync cycle.
    runInitialSyncIfNeeded()
      .catch((err) => {
        console.error("[sync] Initial sync scan failed:", err);
      })
      .finally(() => {
        engine.startSync();
      });

    // Window focus → immediate push + pull
    function handleFocus() {
      engineRef.current?.triggerPush();
      engineRef.current?.triggerPull();
    }

    // Online/offline handling
    function handleOnline() {
      setIsOnline(true);
      engineRef.current?.startSync();
    }

    function handleOffline() {
      setIsOnline(false);
      engineRef.current?.stopSync();
    }

    // Custom event: book mutations trigger immediate push
    function handlePushNeeded() {
      setHasPendingChanges(true);
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

  return {
    isSyncing,
    hasPendingChanges,
    lastSyncedAt,
    syncError,
    isOnline,
    isActive: isAuthenticated,
    triggerSync,
  };
}
