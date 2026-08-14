import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  schema: vi.fn(),
  lease: vi.fn(),
  units: vi.fn(),
  usage: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getReadingAgentSchemaHealth: mocks.schema,
  getCurrentReadingAgentLease: mocks.lease,
  listRecentReadingIngestUnits: mocks.units,
  getLatestReadingAgentUsage: mocks.usage,
}));

import { loader } from "~/routes/api.reading-agent.status";

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
});

afterEach(() => {
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

  it("returns schema health without reading missing queue tables", async () => {
    mocks.schema.mockResolvedValue({
      ok: false,
      missingColumns: ["reading_ingest_unit.next_attempt_at"],
    });
    const response = await loader({ request: request() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sidecarConfigured: false,
      schema: { ok: false, missingColumns: ["reading_ingest_unit.next_attempt_at"] },
      lease: null,
      units: [],
      usage: null,
    });
    expect(mocks.lease).not.toHaveBeenCalled();
    expect(mocks.units).not.toHaveBeenCalled();
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it("returns configured sidecar, lease, filtered text-free units, and latest usage", async () => {
    process.env.READING_AGENT_URL = "https://user:password@example.com/agent";
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

    const response = await loader({ request: request("?bookId=book-1") });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sidecarConfigured).toBe(true);
    expect(body).not.toHaveProperty("sidecarUrl");
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
});
