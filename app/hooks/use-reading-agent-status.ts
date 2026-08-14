import { useEffect, useState } from "react";

export const READING_AGENT_STATUS_POLL_MS = 2_000;

export type ReadingAgentUnitStatus = "pending" | "processing" | "done" | "skipped" | "error";

export interface ReadingAgentStatus {
  sidecarConfigured: boolean;
  schema: { ok: boolean; missingColumns?: string[] };
  lease: {
    unitId: string;
    bookId: string;
    expiresAt: string;
    chapterLabel: string | null;
    locator: string;
  } | null;
  units: Array<{
    unitId: string;
    bookId: string;
    chapterLabel: string | null;
    locator: string;
    unitKind: "epub-spine" | "pdf-page";
    status: ReadingAgentUnitStatus;
    attemptCount: number;
    nextAttemptAt: string;
    claimedAt: string | null;
    lastSeenAt: string;
    lastError: string | null;
  }>;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    model: string | null;
    source: string;
    createdAt: string;
  } | null;
}

async function fetchReadingAgentStatus(signal: AbortSignal): Promise<ReadingAgentStatus> {
  const response = await fetch("/api/reading-agent/status", { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Authentication required. Reload to sign in."
        : `Status request failed (${response.status}).`,
    );
  }
  return (await response.json()) as ReadingAgentStatus;
}

export function useReadingAgentStatus() {
  const [data, setData] = useState<ReadingAgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    let inFlight = false;

    const poll = async () => {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      controller = new AbortController();
      try {
        const status = await fetchReadingAgentStatus(controller.signal);
        if (disposed) return;
        setData(status);
        setError(null);
        setUpdatedAt(new Date());
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Unable to load reading-agent status.");
      } finally {
        inFlight = false;
        if (!disposed) setIsLoading(false);
      }
    };

    const startOrPause = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === "visible") {
        void poll();
        interval = setInterval(() => void poll(), READING_AGENT_STATUS_POLL_MS);
      } else {
        controller?.abort();
      }
    };

    startOrPause();
    document.addEventListener("visibilitychange", startOrPause);
    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
      controller?.abort();
      document.removeEventListener("visibilitychange", startOrPause);
    };
  }, []);

  return { data, error, isLoading, updatedAt };
}
