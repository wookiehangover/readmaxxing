import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "~/lib/context/auth-context";
import { makeSyncEngine, type SyncEngine } from "./sync-engine";

export interface SyncState {
  /** Whether a sync cycle is currently running. */
  isSyncing: boolean;
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
  const { isAuthenticated } = useAuth();
  const engineRef = useRef<SyncEngine | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
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

  useEffect(() => {
    if (!isAuthenticated) {
      // Not authenticated — tear down any existing engine
      if (engineRef.current) {
        engineRef.current.stopSync();
        engineRef.current = null;
      }
      return;
    }

    // Create and start the sync engine
    const engine = makeSyncEngine({
      onSyncStart: () => setIsSyncing(true),
      onSyncEnd: () => {
        setIsSyncing(false);
        setSyncError(null);
        setLastSyncedAt(new Date().toISOString());
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
    engine.startSync();

    // Window focus → immediate push
    function handleFocus() {
      engineRef.current?.triggerPush();
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
  }, [isAuthenticated]);

  return {
    isSyncing,
    lastSyncedAt,
    syncError,
    isOnline,
    isActive: isAuthenticated,
    triggerSync,
  };
}
