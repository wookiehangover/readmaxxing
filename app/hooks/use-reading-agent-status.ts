import { useCallback, useEffect, useRef, useState } from "react";

export const READING_AGENT_STATUS_POLL_MS = 2_000;
export const READING_AGENT_STATUS_TIMEOUT_MS = 5_000;

const STATUS_TIMEOUT_MESSAGE = "Status request timed out. Retrying automatically.";

export type ReadingAgentUnitStatus = "pending" | "processing" | "done" | "skipped" | "error";

export interface ReadingAgentStatus {
  hostConfigured: boolean;
  hostActive: boolean;
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
        : response.status === 504
          ? STATUS_TIMEOUT_MESSAGE
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
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const poll = useCallback(async (options?: { force?: boolean }) => {
    if (document.visibilityState !== "visible") return;
    if (inFlightRef.current && !options?.force) return;
    controllerRef.current?.abort();
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, READING_AGENT_STATUS_TIMEOUT_MS);
    try {
      const status = await fetchReadingAgentStatus(controller.signal);
      if (requestId !== requestIdRef.current) return;
      setData(status);
      setError(null);
      setUpdatedAt(new Date());
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      if (timedOut) setError(STATUS_TIMEOUT_MESSAGE);
      else if (controller.signal.aborted) return;
      else
        setError(cause instanceof Error ? cause.message : "Unable to load reading-agent status.");
    } finally {
      clearTimeout(timeout);
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  const refetch = useCallback(() => poll({ force: true }), [poll]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const startOrPause = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === "visible") {
        void poll();
        interval = setInterval(() => void poll(), READING_AGENT_STATUS_POLL_MS);
      } else {
        controllerRef.current?.abort();
      }
    };

    startOrPause();
    document.addEventListener("visibilitychange", startOrPause);
    return () => {
      requestIdRef.current += 1;
      inFlightRef.current = false;
      if (interval) clearInterval(interval);
      controllerRef.current?.abort();
      document.removeEventListener("visibilitychange", startOrPause);
    };
  }, [poll]);

  return { data, error, isLoading, updatedAt, refetch };
}
