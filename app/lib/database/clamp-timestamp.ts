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

export function clampNullableTimestamp(
  ts: Date | null | undefined,
  skewMs: number = DEFAULT_UPDATED_AT_SKEW_MS,
): string | null {
  if (ts == null) return null;
  return clampUpdatedAt(ts, skewMs);
}
