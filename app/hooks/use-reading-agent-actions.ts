import { useCallback, useRef, useState } from "react";
import {
  postReadingAgentAction,
  type ReadingAgentQueueAction,
} from "~/lib/reading-agent/actions-client";

export function useReadingAgentActions(refresh: () => void | Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const run = useCallback(
    async (payload: ReadingAgentQueueAction) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setError(null);
      try {
        await postReadingAgentAction(payload);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to run reading-agent action.");
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [refresh],
  );

  return {
    pending,
    error,
    start: useCallback(() => run({ action: "start" }), [run]),
    stop: useCallback(() => run({ action: "stop" }), [run]),
    retry: useCallback((unitId: string) => run({ action: "retry", unitId }), [run]),
    reset: useCallback((unitId: string) => run({ action: "reset", unitId }), [run]),
  };
}
