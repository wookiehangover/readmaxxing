// ---------------------------------------------------------------------------
// Per-book upload retry state with exponential backoff
// ---------------------------------------------------------------------------

/**
 * Backoff schedule applied to failing blob uploads, keyed by attempt count.
 * Attempts beyond the last slot stay capped at the final value (30 min).
 */
export const UPLOAD_BACKOFF_SCHEDULE_MS: readonly number[] = [
  30_000, 60_000, 300_000, 900_000, 1_800_000,
];

export interface UploadRetryEntry {
  readonly attempts: number;
  readonly nextRetryAt: number;
}

export function uploadRetryKey(bookId: string, type: "file" | "cover"): string {
  return `${bookId}:${type}`;
}

export function getUploadRetryDelayMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts, 1), UPLOAD_BACKOFF_SCHEDULE_MS.length) - 1;
  return UPLOAD_BACKOFF_SCHEDULE_MS[idx];
}

export type UploadAttemptDecision = { attempt: true } | { attempt: false; retryInMs: number };

export function shouldAttemptUpload(
  state: Map<string, UploadRetryEntry>,
  key: string,
  now: number,
): UploadAttemptDecision {
  const entry = state.get(key);
  if (!entry || now >= entry.nextRetryAt) return { attempt: true };
  return { attempt: false, retryInMs: entry.nextRetryAt - now };
}

export function recordUploadFailure(
  state: Map<string, UploadRetryEntry>,
  key: string,
  now: number,
): UploadRetryEntry {
  const prev = state.get(key);
  const attempts = (prev?.attempts ?? 0) + 1;
  const entry: UploadRetryEntry = {
    attempts,
    nextRetryAt: now + getUploadRetryDelayMs(attempts),
  };
  state.set(key, entry);
  return entry;
}

export function clearUploadRetry(state: Map<string, UploadRetryEntry>, key: string): void {
  state.delete(key);
}

// ---------------------------------------------------------------------------
// In-call retry: classify blob SDK errors and retry transient ones
// ---------------------------------------------------------------------------

/**
 * Classification of errors thrown by `@vercel/blob/client#upload`. The SDK
 * exposes typed error classes (`BlobAccessError`, `BlobServiceNotAvailable`,
 * `BlobServiceRateLimited`, etc.) but the `/client` subpath does not re-export
 * them, so we match on `constructor.name` / `name` / message fragments.
 */
export type BlobErrorClass = "auth" | "transient" | "permanent";

export function classifyBlobError(err: unknown): BlobErrorClass {
  if (!(err instanceof Error)) return "permanent";
  const ctor = err.constructor?.name ?? "";
  const name = err.name;
  const msg = err.message;

  // Auth: access denied (403) or failed client-token exchange (401/403).
  if (
    ctor === "BlobAccessError" ||
    name === "BlobAccessError" ||
    ctor === "BlobClientTokenExpiredError" ||
    name === "BlobClientTokenExpiredError" ||
    /client token/i.test(msg)
  ) {
    return "auth";
  }

  // Permanent: validation / not-found / aborted — retrying won't help.
  if (
    ctor === "BlobFileTooLargeError" ||
    name === "BlobFileTooLargeError" ||
    ctor === "BlobContentTypeNotAllowedError" ||
    name === "BlobContentTypeNotAllowedError" ||
    ctor === "BlobPathnameMismatchError" ||
    name === "BlobPathnameMismatchError" ||
    ctor === "BlobPreconditionFailedError" ||
    name === "BlobPreconditionFailedError" ||
    ctor === "BlobNotFoundError" ||
    name === "BlobNotFoundError" ||
    ctor === "BlobStoreNotFoundError" ||
    name === "BlobStoreNotFoundError" ||
    ctor === "BlobStoreSuspendedError" ||
    name === "BlobStoreSuspendedError" ||
    ctor === "BlobRequestAbortedError" ||
    name === "BlobRequestAbortedError"
  ) {
    return "permanent";
  }

  // Transient: service outage, rate limiting, unknown server error.
  if (
    ctor === "BlobServiceNotAvailable" ||
    name === "BlobServiceNotAvailable" ||
    ctor === "BlobServiceRateLimited" ||
    name === "BlobServiceRateLimited" ||
    ctor === "BlobUnknownError" ||
    name === "BlobUnknownError"
  ) {
    return "transient";
  }

  // Network / fetch-level failures (`TypeError: Failed to fetch` and the like).
  if (err instanceof TypeError) return "transient";
  if (/network|failed to fetch|fetch failed/i.test(msg)) return "transient";

  return "permanent";
}

/**
 * Delays applied between in-call retry attempts for transient upload errors.
 * Total attempts = `length + 1` (initial attempt plus one retry per slot).
 */
export const UPLOAD_INCALL_RETRY_DELAYS_MS: readonly number[] = [500, 2_000, 5_000];

export interface UploadRetryHooks {
  readonly onAuthExpired?: () => void;
  readonly onTransientRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  readonly onGiveUp?: (err: unknown, totalAttempts: number) => void;
  readonly onPermanentFailure?: (err: unknown) => void;
}

/**
 * Execute `performUpload` with bounded in-call retries on transient errors.
 * Auth and permanent errors short-circuit. Returns the upload result on
 * success, or `null` if all attempts were exhausted or a non-retryable error
 * was hit.
 */
export async function runUploadWithRetry<T>(
  performUpload: () => Promise<T>,
  hooks: UploadRetryHooks = {},
  delaysMs: readonly number[] = UPLOAD_INCALL_RETRY_DELAYS_MS,
  sleepMs: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T | null> {
  const maxAttempts = delaysMs.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await performUpload();
    } catch (err) {
      const kind = classifyBlobError(err);
      if (kind === "auth") {
        hooks.onAuthExpired?.();
        return null;
      }
      if (kind === "permanent") {
        hooks.onPermanentFailure?.(err);
        return null;
      }
      if (attempt < maxAttempts) {
        const delay = delaysMs[attempt - 1];
        hooks.onTransientRetry?.(attempt, delay, err);
        await sleepMs(delay);
        continue;
      }
      hooks.onGiveUp?.(err, attempt);
      return null;
    }
  }
  return null;
}
