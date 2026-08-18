import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READING_AGENT_STATUS_TIMEOUT_MS,
  useReadingAgentStatus,
  type ReadingAgentStatus,
} from "~/hooks/use-reading-agent-status";

const emptyStatus: ReadingAgentStatus = {
  gatewayConfigured: true,
  schema: { ok: true },
  lease: null,
  units: [],
  usage: null,
  latestIncrement: null,
  selectedModel: "anthropic/claude-sonnet-4-6",
  lastError: null,
};

function Probe({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useReadingAgentStatus>) => void;
}) {
  onValue(useReadingAgentStatus());
  return null;
}

describe("useReadingAgentStatus", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads after the development StrictMode effect restart", async () => {
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    fetchMock.mockResolvedValue(Response.json(emptyStatus));
    let latest: ReturnType<typeof useReadingAgentStatus> | undefined;

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(Probe, { onValue: (value) => (latest = value) }),
        ),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest?.data).toEqual(emptyStatus);
    expect(latest?.isLoading).toBe(false);
  });

  it("surfaces a timeout, clears loading, and retries without stacking requests", async () => {
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    fetchMock.mockResolvedValue(Response.json(emptyStatus));
    let latest: ReturnType<typeof useReadingAgentStatus> | undefined;

    await act(async () => {
      root.render(createElement(Probe, { onValue: (value) => (latest = value) }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(READING_AGENT_STATUS_TIMEOUT_MS));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest?.isLoading).toBe(false);
    expect(latest?.error).toContain("timed out");

    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest?.data).toEqual(emptyStatus);
    expect(latest?.error).toBeNull();
  });
});
