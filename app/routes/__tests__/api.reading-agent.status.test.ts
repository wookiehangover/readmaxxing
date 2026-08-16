import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  schema: vi.fn(),
  lease: vi.fn(),
  units: vi.fn(),
  usage: vi.fn(),
  activeHost: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getReadingAgentSchemaHealth: mocks.schema,
  getCurrentReadingAgentLease: mocks.lease,
  listRecentReadingIngestUnits: mocks.units,
  getLatestReadingAgentUsage: mocks.usage,
}));
vi.mock("~/lib/reading-agent/agent-host.server", () => ({
  getActiveReadingAgentHost: mocks.activeHost,
}));

import { loader, READING_AGENT_STATUS_TIMEOUT_MS } from "~/routes/api.reading-agent.status";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  readingAgentUrl: process.env.READING_AGENT_URL,
  readingAgentSecret: process.env.READING_AGENT_SECRET,
};

function request(query = ""): Request {
  return new Request(`http://localhost/api/reading-agent/status${query}`);
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://configured";
  delete process.env.READING_AGENT_URL;
  delete process.env.READING_AGENT_SECRET;
  mocks.auth.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.schema.mockReset().mockResolvedValue({ ok: true });
  mocks.lease.mockReset().mockResolvedValue(null);
  mocks.units.mockReset().mockResolvedValue([]);
  mocks.usage.mockReset().mockResolvedValue(null);
  mocks.activeHost.mockReset().mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  if (originalEnv.databaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.readingAgentUrl == null) delete process.env.READING_AGENT_URL;
  else process.env.READING_AGENT_URL = originalEnv.readingAgentUrl;
  if (originalEnv.readingAgentSecret == null) delete process.env.READING_AGENT_SECRET;
  else process.env.READING_AGENT_SECRET = originalEnv.readingAgentSecret;
});

describe("reading-agent status API", () => {
  it("returns 503 when the database is not configured", async () => {
    delete process.env.DATABASE_URL;
    const response = await loader({ request: request() });
    expect(response.status).toBe(503);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await loader({ request: request() });
    expect(response.status).toBe(401);
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  it("returns 504 when a signed-in status database call does not finish", async () => {
    vi.useFakeTimers();
    mocks.units.mockReturnValue(new Promise(() => {}));

    const responsePromise = loader({ request: request() });
    await vi.advanceTimersByTimeAsync(READING_AGENT_STATUS_TIMEOUT_MS);
    const response = await responsePromise;

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toEqual({ error: "status_timeout" });
  });

  it("returns schema health without reading missing queue tables", async () => {
    mocks.schema.mockResolvedValue({
      ok: false,
      missingColumns: ["reading_ingest_unit.next_attempt_at"],
    });
    const response = await loader({ request: request() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hostConfigured: false,
      hostActive: false,
      schema: { ok: false, missingColumns: ["reading_ingest_unit.next_attempt_at"] },
      lease: null,
      units: [],
      usage: null,
    });
    expect(mocks.lease).not.toHaveBeenCalled();
    expect(mocks.units).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("returns configured in-app host, lease, filtered text-free units, and usage", async () => {
    process.env.READING_AGENT_SECRET = "secret";
    mocks.lease.mockResolvedValue({
      bookId: "book-1",
      unitId: "unit-1",
      expiresAt: new Date("2026-01-01T00:05:00Z"),
      chapterLabel: "Chapter 1",
      locator: "chapter-1.xhtml",
    });
    mocks.units.mockResolvedValue([
      {
        unitId: "unit-1",
        bookId: "book-1",
        chapterLabel: "Chapter 1",
        locator: "chapter-1.xhtml",
        unitKind: "epub-spine",
        status: "processing",
        attemptCount: 1,
        nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
        claimedAt: new Date("2026-01-01T00:01:00Z"),
        lastSeenAt: new Date("2026-01-01T00:00:00Z"),
        lastError: null,
      },
    ]);
    mocks.usage.mockResolvedValue({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 18,
      costTotal: "0.01",
      model: "test-model",
      source: "flue",
      createdAt: new Date("2026-01-01T00:02:00Z"),
    });
    mocks.activeHost.mockReturnValue({ url: "http://reading-agent.local" });

    const response = await loader({ request: request("?bookId=book-1") });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.hostConfigured).toBe(true);
    expect(body.hostActive).toBe(true);
    expect(mocks.activeHost).toHaveBeenCalledWith(
      readingConversationId("user-1", "book-1", "unit-1"),
    );
    expect(body).not.toHaveProperty("hostUrl");
    expect(mocks.units).toHaveBeenCalledWith({ userId: "user-1", bookId: "book-1" });
    expect(body.lease).toMatchObject({ unitId: "unit-1", chapterLabel: "Chapter 1" });
    expect(body.units[0]).not.toHaveProperty("text");
    expect(body.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 18,
      model: "test-model",
      source: "flue",
      createdAt: "2026-01-01T00:02:00.000Z",
    });
  });

  it("reports an unexpired database lease without an in-app host as inactive", async () => {
    mocks.lease.mockResolvedValue({
      bookId: "book-orphan",
      unitId: "unit-orphan",
      expiresAt: new Date("2099-01-01T00:05:00Z"),
      chapterLabel: null,
      locator: "page:14",
    });

    const response = await loader({ request: request() });

    await expect(response.json()).resolves.toMatchObject({
      hostActive: false,
      lease: { unitId: "unit-orphan" },
    });
    expect(mocks.activeHost).toHaveBeenCalledOnce();
  });
});
