import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadingAgentConversation } from "~/hooks/use-reading-agent-conversation";
import type { ReadingAgentConversation } from "~/lib/reading-agent/conversation";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Probe({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useReadingAgentConversation>) => void;
}) {
  onValue(useReadingAgentConversation());
  return null;
}

describe("useReadingAgentConversation", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls only while the tab is visible and surfaces live transcripts", async () => {
    const payload: ReadingAgentConversation = {
      phase: "live",
      conversationId: "conversation-1",
      bookId: "book-1",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          purpose: "assistant",
          display: "visible",
          parts: [{ type: "text", text: "Updated the wiki.", state: "done" }],
        },
      ],
    };
    fetchMock.mockResolvedValue(Response.json(payload));
    let latest: ReturnType<typeof useReadingAgentConversation> | undefined;
    await act(async () => {
      root.render(
        createElement(Probe, {
          onValue: (value) => {
            latest = value;
          },
        }),
      );
    });
    await act(async () => {});
    expect(latest?.data.phase).toBe("live");
    expect(latest?.data.messages[0]?.parts[0]).toMatchObject({ text: "Updated the wiki." });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
