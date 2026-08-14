export type ReadingAgentQueueAction =
  | { action: "start" }
  | { action: "stop" }
  | { action: "retry"; unitId: string }
  | { action: "reset"; unitId: string };

export function isLiveReadingAgentLease(
  lease: { expiresAt: string } | null | undefined,
  now = Date.now(),
): boolean {
  if (!lease) return false;
  const expiresAt = Date.parse(lease.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function readingAgentActionAvailability(
  status: {
    hostConfigured: boolean;
    schema: { ok: boolean };
    lease: { expiresAt: string } | null;
  },
  now = Date.now(),
) {
  const ready = status.hostConfigured && status.schema.ok;
  const liveLease = isLiveReadingAgentLease(status.lease, now);
  return {
    canStart: ready && !liveLease,
    canStop: ready && status.lease !== null,
    canRetry: ready,
    canReset: ready,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function actionErrorMessage(status: number, body: unknown): string {
  const error = isRecord(body) && typeof body.error === "string" ? body.error : null;
  if (status === 401 || error === "auth_required") {
    return "Authentication required. Reload to sign in.";
  }
  if (error === "agent_not_configured" || error === "sidecar_not_configured") {
    return "Agent host is not configured.";
  }
  if (error === "schema_stale") return "Queue schema is stale.";
  if (error === "not_found") return "Unit not found.";
  if (error === "not_retryable") return "This unit cannot be retried.";
  if (error === "not_resettable") return "This unit cannot be reset.";
  return error ? `Action failed (${error}).` : `Action failed (${status}).`;
}

export async function postReadingAgentAction(payload: ReadingAgentQueueAction): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/reading-agent/actions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : "Failed to run reading-agent action.");
  }

  if (response.ok) return;

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  throw new Error(actionErrorMessage(response.status, body));
}
