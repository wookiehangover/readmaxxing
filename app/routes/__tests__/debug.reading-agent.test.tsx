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
  hostConfigured: true,
  hostActive: false,
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

const liveLease: NonNullable<ReadingAgentStatus["lease"]> = {
  unitId: "unit-1",
  bookId: "book-1",
  chapterLabel: "Chapter 14",
  locator: "chapter-14.xhtml",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const pendingUnit: ReadingAgentStatus["units"][number] = {
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
};

const processingUnit: ReadingAgentStatus["units"][number] = {
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
};

function respond(
  status: ReadingAgentStatus,
  conversation: ReadingAgentConversation = emptyConversation,
  options?: { action?: (body: unknown) => Promise<Response> | Response },
) {
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/reading-agent/actions")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Promise.resolve(options?.action?.(body) ?? Response.json({ ok: true }));
    }
    if (url.includes("/api/reading-agent/conversation")) {
      return Promise.resolve(Response.json(conversation));
    }
    if (url.includes("/api/reading-agent/debug")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return Promise.resolve(
        Response.json({
          ...status,
          selectedModel: body?.model ?? "anthropic/claude-sonnet-4-6",
          conversationTail: null,
          lastError: null,
        }),
      );
    }
    return Promise.resolve(Response.json(status));
  });
}

function button(label: string) {
  return Array.from(container!.querySelectorAll("button")).find(
    (node) => node.textContent === label,
  );
}

function postedActions() {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
      return (
        url.includes("/api/reading-agent/actions") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    })
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

function postedDebugModels() {
  return fetchMock.mock.calls
    .filter(([input, init]) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
      return (
        url.includes("/api/reading-agent/debug") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    })
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
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
    expect(container!.textContent).toContain("Agent host");
    expect(container!.textContent).toContain("anthropic/claude-sonnet-4-6");
    expect(container!.textContent).not.toContain("Not configured");
  });

  it("stores the selected debug model without starting the queue", async () => {
    respond(emptyStatus);
    await renderPage();
    const trigger = container!.querySelector<HTMLButtonElement>('[aria-label="Next ingest model"]');
    expect(trigger?.disabled).toBe(false);

    await act(async () => trigger?.click());
    const option = Array.from(
      document.body.querySelectorAll<HTMLElement>("[data-slot=select-item]"),
    ).find((item) => item.textContent === "openai/gpt-5.5");
    expect(option).toBeDefined();
    await act(async () => option?.click());

    expect(postedDebugModels()).toEqual([{ model: "openai/gpt-5.5" }]);
    expect(postedActions()).toEqual([]);
  });

  it("renders a processing lease and unit", async () => {
    respond({
      ...emptyStatus,
      lease: liveLease,
      units: [processingUnit, pendingUnit],
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

  it("renders the connecting conversation state", async () => {
    respond(emptyStatus, {
      phase: "connecting",
      conversationId: "conversation-1",
      bookId: "book-1",
      messages: [],
    });
    await renderPage();
    expect(container!.textContent).toContain("connecting");
    expect(container!.textContent).toContain("No live conversation");
    expect(container!.textContent).toContain(
      "The current lease is waiting for the agent host conversation.",
    );
  });

  it("renders a conversation request error", async () => {
    respond(emptyStatus, {
      phase: "error",
      conversationId: "conversation-1",
      bookId: "book-1",
      messages: [],
    });
    await renderPage();
    expect(container!.textContent).toContain("error");
    expect(container!.textContent).toContain("Unable to load the live conversation.");
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
    expect(button("Start")?.disabled).toBe(true);
    expect(button("Stop")).toBeUndefined();
    expect(button("Retry")).toBeUndefined();
  });

  it("enables Start when idle and posts start", async () => {
    respond(emptyStatus);
    await renderPage();
    const start = button("Start");
    expect(start?.disabled).toBe(false);
    expect(button("Stop")?.disabled).toBe(true);
    await act(async () => start?.click());
    expect(postedActions()).toEqual([{ action: "start" }]);
  });

  it("enables Stop for a live lease and posts stop", async () => {
    respond({
      ...emptyStatus,
      hostActive: true,
      lease: liveLease,
      units: [processingUnit],
    });
    await renderPage();
    const stop = button("Stop");
    expect(button("Start")?.disabled).toBe(true);
    expect(stop?.disabled).toBe(false);
    expect(button("Retry")?.disabled).toBe(false);
    expect(button("Reset")?.disabled).toBe(false);
    await act(async () => stop?.click());
    expect(postedActions()).toEqual([{ action: "stop" }]);
  });

  it("enables Start and Stop for an unexpired orphan without an active host", async () => {
    respond({
      ...emptyStatus,
      lease: liveLease,
    });
    await renderPage();
    expect(button("Start")?.disabled).toBe(false);
    expect(button("Stop")?.disabled).toBe(false);
  });

  it("keeps Stop enabled for an expired current lease", async () => {
    respond({
      ...emptyStatus,
      lease: { ...liveLease, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    await renderPage();
    expect(button("Start")?.disabled).toBe(false);
    expect(button("Stop")?.disabled).toBe(false);
  });

  it("shows Retry on pending and error rows and posts retry", async () => {
    respond({
      ...emptyStatus,
      units: [
        pendingUnit,
        { ...processingUnit, unitId: "unit-done", status: "done" },
        {
          ...pendingUnit,
          unitId: "unit-2",
          status: "error",
          lastError: "Gateway unavailable",
        },
      ],
    });
    await renderPage();
    const retries = Array.from(container!.querySelectorAll("button")).filter(
      (node) => node.textContent === "Retry",
    );
    expect(retries).toHaveLength(2);
    expect(retries.every((node) => !node.disabled)).toBe(true);
    await act(async () => retries[0]?.click());
    expect(postedActions()).toEqual([{ action: "retry", unitId: "unit-0" }]);
  });

  it("shows Reset on pending, error, and processing rows but not settled rows", async () => {
    respond({
      ...emptyStatus,
      units: [
        { ...pendingUnit, attemptCount: 8 },
        { ...processingUnit, unitId: "unit-done", status: "done" },
        { ...processingUnit, unitId: "unit-skipped", status: "skipped" },
        processingUnit,
        {
          ...pendingUnit,
          unitId: "unit-2",
          status: "error",
          attemptCount: 8,
          lastError: "Gateway unavailable",
        },
      ],
    });
    await renderPage();
    const resets = Array.from(container!.querySelectorAll("button")).filter(
      (node) => node.textContent === "Reset",
    );
    expect(resets).toHaveLength(3);
    expect(resets.every((node) => !node.disabled)).toBe(true);
    await act(async () => resets[0]?.click());
    expect(postedActions()).toEqual([{ action: "reset", unitId: "unit-0" }]);
  });

  it("disables Start and Stop when the agent host is not configured", async () => {
    respond({
      ...emptyStatus,
      hostConfigured: false,
      lease: liveLease,
      units: [processingUnit, pendingUnit],
    });
    await renderPage();
    expect(button("Start")?.disabled).toBe(true);
    expect(button("Stop")?.disabled).toBe(true);
    expect(button("Retry")?.disabled).toBe(true);
    expect(button("Reset")?.disabled).toBe(true);
  });

  it("disables buttons while an action request is in flight and shows POST errors", async () => {
    let resolveAction: ((value: Response) => void) | undefined;
    respond({ ...emptyStatus, units: [pendingUnit] }, emptyConversation, {
      action: () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    });
    await renderPage();
    const reset = button("Reset");
    expect(reset?.disabled).toBe(false);
    act(() => reset?.click());
    await act(async () => {});
    expect(button("Start")?.disabled).toBe(true);
    expect(button("Stop")?.disabled).toBe(true);
    expect(button("Retry")?.disabled).toBe(true);
    expect(button("Reset")?.disabled).toBe(true);
    resolveAction?.(Response.json({ error: "agent_not_configured" }, { status: 409 }));
    await act(async () => {});
    expect(container!.textContent).toContain("Action failed");
    expect(container!.textContent).toContain("Agent host is not configured.");
    expect(button("Start")?.disabled).toBe(false);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    act(() => setVisibility("hidden"));
    await act(async () => vi.advanceTimersByTimeAsync(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    act(() => setVisibility("visible"));
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(7);
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
