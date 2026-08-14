import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyReadingAgentConversation,
  type ReadingAgentConversation,
} from "~/lib/reading-agent/conversation";

export const READING_AGENT_CONVERSATION_POLL_MS = 2_000;
export const READING_AGENT_CONVERSATION_TIMEOUT_MS = 5_000;

const CONVERSATION_TIMEOUT_MESSAGE = "Conversation request timed out. Retrying automatically.";

async function fetchReadingAgentConversation(
  signal: AbortSignal,
): Promise<ReadingAgentConversation> {
  const response = await fetch("/api/reading-agent/conversation", { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Authentication required. Reload to sign in."
        : `Conversation request failed (${response.status}).`,
    );
  }
  return (await response.json()) as ReadingAgentConversation;
}

export function useReadingAgentConversation() {
  const [data, setData] = useState<ReadingAgentConversation>(
    emptyReadingAgentConversation("loading"),
  );
  const [error, setError] = useState<string | null>(null);
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
    }, READING_AGENT_CONVERSATION_TIMEOUT_MS);
    try {
      const conversation = await fetchReadingAgentConversation(controller.signal);
      if (requestId !== requestIdRef.current) return;
      setData(conversation);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      if (timedOut) setError(CONVERSATION_TIMEOUT_MESSAGE);
      else if (controller.signal.aborted) return;
      else setError(cause instanceof Error ? cause.message : "Unable to load conversation.");
      setData(emptyReadingAgentConversation("error"));
    } finally {
      clearTimeout(timeout);
      if (requestId === requestIdRef.current) inFlightRef.current = false;
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
        interval = setInterval(() => void poll(), READING_AGENT_CONVERSATION_POLL_MS);
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

  return { data, error, refetch };
}
