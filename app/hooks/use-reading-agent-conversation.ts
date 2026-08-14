import { useEffect, useState } from "react";
import {
  emptyReadingAgentConversation,
  type ReadingAgentConversation,
} from "~/lib/reading-agent/conversation";

export const READING_AGENT_CONVERSATION_POLL_MS = 2_000;

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
        const conversation = await fetchReadingAgentConversation(controller.signal);
        if (disposed) return;
        setData(conversation);
        setError(null);
      } catch (cause) {
        if (disposed || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Unable to load conversation.");
        setData(emptyReadingAgentConversation("error"));
      } finally {
        inFlight = false;
      }
    };

    const startOrPause = () => {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === "visible") {
        void poll();
        interval = setInterval(() => void poll(), READING_AGENT_CONVERSATION_POLL_MS);
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

  return { data, error };
}
