import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";

const mocks = vi.hoisted(() => {
  class FakeFlueApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown) {
      super("flue");
      this.status = status;
      this.body = body;
    }
  }
  return {
    auth: vi.fn(),
    schema: vi.fn(),
    lease: vi.fn(),
    history: vi.fn(),
    createFlueClient: vi.fn(),
    FakeFlueApiError,
  };
});

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getReadingAgentSchemaHealth: mocks.schema,
  getLiveReadingAgentLease: mocks.lease,
}));
vi.mock("@flue/sdk", () => ({
  createFlueClient: mocks.createFlueClient,
  FlueApiError: mocks.FakeFlueApiError,
}));

import { loader } from "~/routes/api.reading-agent.conversation";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  readingAgentUrl: process.env.READING_AGENT_URL,
  readingAgentSecret: process.env.READING_AGENT_SECRET,
};

function request(): Request {
  return new Request("http://localhost/api/reading-agent/conversation");
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://configured";
  process.env.READING_AGENT_URL = "https://sidecar.example/agents/reading-scribe";
  process.env.READING_AGENT_SECRET = "sidecar-secret";
  mocks.auth.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.schema.mockReset().mockResolvedValue({ ok: true });
  mocks.lease.mockReset().mockResolvedValue({
    bookId: "book-1",
    unitId: "unit-1",
    expiresAt: new Date(Date.now() + 5 * 60_000),
    chapterLabel: "Chapter 14",
    locator: "chapter-14.xhtml",
  });
  mocks.history.mockReset();
  mocks.createFlueClient.mockReset().mockReturnValue({ history: mocks.history });
});

afterEach(() => {
  if (originalEnv.databaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.readingAgentUrl == null) delete process.env.READING_AGENT_URL;
  else process.env.READING_AGENT_URL = originalEnv.readingAgentUrl;
  if (originalEnv.readingAgentSecret == null) delete process.env.READING_AGENT_SECRET;
  else process.env.READING_AGENT_SECRET = originalEnv.readingAgentSecret;
});

describe("reading-agent conversation API", () => {
  it("returns 401 for an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await loader({ request: request() });
    expect(response.status).toBe(401);
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("returns an absent payload when sidecar env is missing", async () => {
    delete process.env.READING_AGENT_URL;
    delete process.env.READING_AGENT_SECRET;
    const response = await loader({ request: request() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      phase: "absent",
      conversationId: null,
      bookId: null,
      messages: [],
    });
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("returns an absent payload when schema or lease is missing", async () => {
    mocks.schema.mockResolvedValue({
      ok: false,
      missingColumns: ["reading_agent_lease.expires_at"],
    });
    const stale = await loader({ request: request() });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({ phase: "absent", messages: [] });
    expect(mocks.lease).not.toHaveBeenCalled();

    mocks.schema.mockResolvedValue({ ok: true });
    mocks.lease.mockResolvedValue(null);
    const idle = await loader({ request: request() });
    expect(idle.status).toBe(200);
    await expect(idle.json()).resolves.toMatchObject({ phase: "absent", conversationId: null });
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("returns an absent payload when the live lease has expired", async () => {
    mocks.lease.mockResolvedValue(null);
    const response = await loader({ request: request() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      phase: "absent",
      conversationId: null,
      bookId: null,
      messages: [],
    });
    expect(mocks.lease).toHaveBeenCalledWith("user-1");
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("returns connecting when the lease conversation is not on the sidecar yet", async () => {
    mocks.history.mockRejectedValue(new mocks.FakeFlueApiError(404, { error: "missing" }));
    const response = await loader({ request: request() });
    const conversationId = readingConversationId("user-1", "book-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      phase: "connecting",
      conversationId,
      bookId: "book-1",
      messages: [],
    });
    expect(mocks.createFlueClient).toHaveBeenCalledWith({
      url: `https://sidecar.example/agents/reading-scribe/${conversationId}`,
      token: "sidecar-secret",
    });
  });

  it("returns a sanitized live conversation and never the page body or secret", async () => {
    mocks.history.mockResolvedValue({
      messages: [
        {
          id: "user-1",
          role: "user",
          purpose: "user",
          display: "visible",
          parts: [{ type: "text", text: "Chapter 14 page body", state: "done" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          purpose: "assistant",
          display: "visible",
          parts: [
            { type: "reasoning", text: "Need the current wiki.", state: "done" },
            {
              type: "dynamic-tool",
              toolName: "readWiki",
              state: "output-available",
              output: "page",
            },
            { type: "text", text: "Updated the wiki.", state: "done" },
          ],
        },
      ],
    });

    const response = await loader({ request: request() });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.phase).toBe("live");
    expect(body.conversationId).toBe(readingConversationId("user-1", "book-1"));
    expect(JSON.stringify(body)).not.toContain("Chapter 14 page body");
    expect(JSON.stringify(body)).not.toContain("sidecar-secret");
    expect(body.messages).toEqual([
      { id: "user-1", role: "user", purpose: "user", display: "visible", parts: [] },
      {
        id: "assistant-1",
        role: "assistant",
        purpose: "assistant",
        display: "visible",
        parts: [
          { type: "reasoning", text: "Need the current wiki.", state: "done" },
          { type: "dynamic-tool", toolName: "readWiki", state: "output-available" },
          { type: "text", text: "Updated the wiki.", state: "done" },
        ],
      },
    ]);
  });
});
