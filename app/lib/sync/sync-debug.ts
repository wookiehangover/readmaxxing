const STORAGE_KEY = "sync_debug";

export function isSyncDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function syncDebugLog(event: string, data?: Record<string, unknown>): void {
  if (!isSyncDebugEnabled()) return;
  if (data === undefined) {
    console.log(`[sync-debug] ${event}`);
  } else {
    console.log(`[sync-debug] ${event}`, data);
  }
}
