let pending: Promise<unknown> = Promise.resolve();

/** A response/ACK must not race another sync cycle's cross-database remap. */
export function withSyncIdentityLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    // Shared local databases also need exclusion across tabs and account switches.
    return navigator.locks.request("readmax:sync-identity", work);
  }
  // Non-browser harnesses and browsers without Web Locks still serialize this realm.
  const result = pending.then(work, work);
  pending = result.catch(() => {});
  return result;
}
