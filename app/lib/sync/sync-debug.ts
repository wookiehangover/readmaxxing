// ---------------------------------------------------------------------------
// Opt-in sync diagnostic logging
// ---------------------------------------------------------------------------
//
// Verbose sync logs are silent by default. To enable them in a running tab:
//
//   localStorage.setItem("sync_debug", "1")
//
// Warnings and errors in the sync pipeline are always logged — this flag only
// gates additional structured diagnostics (upload attempts, push/pull cycle
// summaries, backoff skips). Only metadata is logged (ids, types, sizes); no
// file contents or other PII are included.

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
