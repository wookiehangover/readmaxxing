import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IDockviewPanelProps } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlinePanel, OUTLINE_POLL_MS } from "../outline-panel";
import { ReadingArtifactsError } from "~/lib/reading-agent/artifacts-client";

const fetchReadingArtifacts = vi.hoisted(() => vi.fn());

vi.mock("~/lib/reading-agent/artifacts-client", async () => {
  const actual = await vi.importActual<typeof import("~/lib/reading-agent/artifacts-client")>(
    "~/lib/reading-agent/artifacts-client",
  );
  return { ...actual, fetchReadingArtifacts };
});

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="outline-markdown">{children}</div>
  ),
}));

vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const outline = {
  bookId: "book-1",
  artifacts: {
    outline: {
      content: "# Chapter 1\n\nSiddhartha leaves home.",
      revisionId: "revision-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    characters: null,
    wiki: null,
  },
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderPanel() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const props = {
    params: { bookId: "book-1", bookTitle: "Siddhartha" },
    api: {
      isVisible: true,
      onDidVisibilityChange: () => ({ dispose() {} }),
    },
  } as unknown as IDockviewPanelProps<{ bookId: string; bookTitle: string }>;
  act(() => root!.render(<OutlinePanel {...props} />));
}

beforeEach(() => {
  fetchReadingArtifacts.mockReset();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
});

describe("OutlinePanel", () => {
  it("renders outline markdown after a successful fetch", async () => {
    fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    expect(container!.textContent).toContain("Loading outline…");
    await act(async () => {});
    expect(container!.querySelector("[data-testid='outline-markdown']")?.textContent).toBe(
      "# Chapter 1\n\nSiddhartha leaves home.",
    );
  });

  it("shows a sign-in prompt on 401", async () => {
    fetchReadingArtifacts.mockRejectedValue(
      new ReadingArtifactsError("auth_required", 401, "Authentication required"),
    );
    renderPanel();
    await act(async () => {});
    expect(container!.textContent).toContain("Sign in to view the outline for");
    expect(container!.querySelector("a")?.getAttribute("href")).toBe("/login");
  });

  it("shows a keep-reading empty state when the outline is missing", async () => {
    fetchReadingArtifacts.mockResolvedValue({
      bookId: "book-1",
      artifacts: { outline: null, characters: null, wiki: null },
    });
    renderPanel();
    await act(async () => {});
    expect(container!.textContent).toContain("No outline yet");
    expect(container!.textContent).toContain("Keep reading");
  });

  it("retries a failed fetch from the error state", async () => {
    fetchReadingArtifacts
      .mockRejectedValueOnce(new ReadingArtifactsError("request_failed", 500, "Failed"))
      .mockResolvedValueOnce(outline);
    renderPanel();
    await act(async () => {});
    expect(container!.textContent).toContain("Unable to load the outline.");
    await act(async () => {
      container!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(container!.querySelector("[data-testid='outline-markdown']")?.textContent).toContain(
      "Siddhartha leaves home.",
    );
  });

  it("polls while visible without remounting", async () => {
    vi.useFakeTimers();
    fetchReadingArtifacts.mockResolvedValue(outline);
    renderPanel();
    await act(async () => {});
    expect(fetchReadingArtifacts).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(OUTLINE_POLL_MS));
    expect(fetchReadingArtifacts).toHaveBeenCalledTimes(2);
  });
});
