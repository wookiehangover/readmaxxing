/**
 * Clamp a client-provided timestamp to at most `skewMs` after the server's
 * current time. Prevents a device with a fast or adversarial clock from
 * poisoning the pull cursor with far-future `updated_at` values.
 *
 * Returns an ISO string suitable for binding directly into a SQL timestamp
 * parameter. When `ts` is null/undefined/invalid, falls back to server
 * NOW().
 */
export const DEFAULT_UPDATED_AT_SKEW_MS = 5 * 60 * 1000;

export function clampUpdatedAt(
  ts: Date | null | undefined,
  skewMs: number = DEFAULT_UPDATED_AT_SKEW_MS,
): string {
  const now = Date.now();
  const upperBound = now + skewMs;
  const candidate = ts?.getTime();
  const effective = candidate != null && Number.isFinite(candidate) ? candidate : now;
  const clamped = Math.min(effective, upperBound);
  return new Date(clamped).toISOString();
}

/**
 * Like {@link clampUpdatedAt} but preserves null/undefined as SQL NULL.
 * Used for nullable client-provided columns such as `deleted_at`, where a
 * far-future tombstone would otherwise match `deleted_at > cursor` on every
 * pull forever (re-delivered to all devices on each sync cycle).
 *
 * An invalid Date is treated as "present but unparseable" and falls back to
 * server NOW() — for a tombstone the intent to delete is clear even if the
 * client clock value is garbage.
 */
export function clampNullableTimestamp(
  ts: Date | null | undefined,
  skewMs: number = DEFAULT_UPDATED_AT_SKEW_MS,
): string | null {
  if (ts == null) return null;
  return clampUpdatedAt(ts, skewMs);
}
