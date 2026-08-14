import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingAgentStatus } from "~/hooks/use-reading-agent-status";
import type { ReadingAgentConversation } from "~/lib/reading-agent/conversation";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("~/lib/effect-runtime", () => ({ AppRuntime: { runPromise: mocks.session } }));

import ReadingAgentDebugPage, { clientLoader } from "~/routes/debug.reading-agent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptyStatus: ReadingAgentStatus = {
  sidecarConfigured: true,
  schema: { ok: true },
  lease: null,
  units: [],
  usage: null,
};

const emptyConversation: ReadingAgentConversation = {
  phase: "absent",
  conversationId: null,
  bookId: null,
  messages: [],
};

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const fetchMock = vi.fn();

function respond(
  status: ReadingAgentStatus,
  conversation: ReadingAgentConversation = emptyConversation,
) {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/reading-agent/conversation")) {
      return Promise.resolve(Response.json(conversation));
    }
    return Promise.resolve(Response.json(status));
  });
}

async function renderPage() {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <ReadingAgentDebugPage />
      </MemoryRouter>,
    ),
  );
  await act(async () => {});
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.session.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reading-agent debug page", () => {
  it("renders the empty state", async () => {
    respond(emptyStatus);
    await renderPage();
    expect(container!.textContent).toContain("No active lease");
    expect(container!.textContent).toContain("No usage recorded");
    expect(container!.textContent).toContain("No live conversation");
    expect(container!.textContent).toContain("No recent ingest units");
  });

  it("renders a processing lease and unit", async () => {
    respond({
      ...emptyStatus,
      lease: {
        unitId: "unit-1",
        bookId: "book-1",
        chapterLabel: "Chapter 14",
        locator: "chapter-14.xhtml",
        expiresAt: "2026-08-14T12:04:00.000Z",
      },
      units: [
        {
          unitId: "unit-1",
          bookId: "book-1",
          chapterLabel: "Chapter 14",
          locator: "chapter-14.xhtml",
          unitKind: "epub-spine",
          status: "processing",
          attemptCount: 1,
          nextAttemptAt: "2026-08-14T12:00:00.000Z",
          claimedAt: "2026-08-14T12:00:00.000Z",
          lastSeenAt: "2026-08-14T12:00:00.000Z",
          lastError: null,
        },
        {
          unitId: "unit-0",
          bookId: "book-2",
          chapterLabel: null,
          locator: "page:3",
          unitKind: "pdf-page",
          status: "pending",
          attemptCount: 0,
          nextAttemptAt: "2026-08-14T12:01:00.000Z",
          claimedAt: null,
          lastSeenAt: "2026-08-14T11:59:00.000Z",
          lastError: null,
        },
      ],
      usage: {
        input: 30,
        output: 12,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 42,
        model: "test-model",
        source: "flue",
        createdAt: "2026-08-14T12:00:30.000Z",
      },
    });
    await renderPage();
    expect(container!.textContent).toContain("Processing");
    expect(container!.textContent).toContain("pending");
    expect(container!.textContent).toContain("Chapter 14");
    expect(container!.textContent).toContain("chapter-14.xhtml");
    expect(container!.textContent).toContain("test-model");
    expect(container!.textContent).toContain("42");
  });

  it("renders live reasoning, tool names, and reply text", async () => {
    respond(emptyStatus, {
      phase: "live",
      conversationId: "conversation-1",
      bookId: "book-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          purpose: "user",
          display: "visible",
          parts: [],
        },
        {
          id: "assistant-1",
          role: "assistant",
          purpose: "assistant",
          display: "visible",
          parts: [
            { type: "reasoning", text: "Need the current wiki.", state: "done" },
            { type: "dynamic-tool", toolName: "readWiki", state: "output-available" },
            { type: "text", text: "Updated the wiki with the new scene.", state: "done" },
          ],
        },
      ],
    });
    await renderPage();
    expect(container!.textContent).toContain("Ingest unit submitted");
    expect(container!.textContent).toContain("Need the current wiki.");
    expect(container!.textContent).toContain("readWiki");
    expect(container!.textContent).toContain("Updated the wiki with the new scene.");
    expect(container!.textContent).not.toContain("Chapter 14 page body");
  });

  it("renders an error unit and its last error", async () => {
    respond({
      ...emptyStatus,
      units: [
        {
          unitId: "unit-2",
          bookId: "book-1",
          chapterLabel: null,
          locator: "page:22",
          unitKind: "pdf-page",
          status: "error",
          attemptCount: 8,
          nextAttemptAt: "2026-08-14T12:05:00.000Z",
          claimedAt: null,
          lastSeenAt: "2026-08-14T12:00:00.000Z",
          lastError: "Gateway unavailable",
        },
      ],
    });
    await renderPage();
    expect(container!.textContent).toContain("error");
    expect(container!.textContent).toContain("Gateway unavailable");
  });

  it("renders schema health failure with missing columns", async () => {
    respond({
      ...emptyStatus,
      schema: { ok: false, missingColumns: ["reading_ingest_unit.next_attempt_at"] },
    });
    await renderPage();
    expect(container!.textContent).toContain("Schema unhealthy");
    expect(container!.textContent).toContain("reading_ingest_unit.next_attempt_at");
    expect(container!.textContent).not.toContain("No recent ingest units");
  });

  it("renders a request error", async () => {
    fetchMock.mockRejectedValue(new Error("Network offline"));
    await renderPage();
    expect(container!.textContent).toContain("Unable to load reading-agent status");
    expect(container!.textContent).toContain("Network offline");
  });

  it("pauses polling while hidden and resumes when visible", async () => {
    vi.useFakeTimers();
    respond(emptyStatus);
    await renderPage();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => setVisibility("hidden"));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => setVisibility("visible"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/reading-agent/conversation"),
      ),
    ).toBe(true);
  });
});

describe("reading-agent debug auth", () => {
  it("redirects an unauthenticated user to login", async () => {
    mocks.session.mockResolvedValue({ user: null });
    const result: unknown = await clientLoader().catch((cause) => cause);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
  });
});
