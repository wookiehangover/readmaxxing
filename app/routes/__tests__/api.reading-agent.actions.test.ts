import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  schema: vi.fn(),
  lease: vi.fn(),
  reclaim: vi.fn(),
  stop: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  getUnit: vi.fn(),
  schedule: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  getReadingAgentSchemaHealth: mocks.schema,
  getCurrentReadingAgentLease: mocks.lease,
  stopReadingIngestUnit: mocks.stop,
  retryReadingIngestUnit: mocks.retry,
  resetReadingIngestUnit: mocks.reset,
  getReadingIngestUnitForUser: mocks.getUnit,
}));
vi.mock("~/lib/reading-agent/dispatch.server", () => ({
  reclaimStaleReadingAgentLease: mocks.reclaim,
  scheduleReadingIngestQueue: mocks.schedule,
}));
import { action } from "~/routes/api.reading-agent.actions";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  gatewayApiKey: process.env.AI_GATEWAY_API_KEY,
  oidcToken: process.env.VERCEL_OIDC_TOKEN,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/reading-agent/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://configured";
  process.env.AI_GATEWAY_API_KEY = "gateway-key";
  delete process.env.VERCEL_OIDC_TOKEN;
  mocks.auth.mockReset().mockResolvedValue({ userId: "user-1" });
  mocks.schema.mockReset().mockResolvedValue({ ok: true });
  mocks.lease.mockReset().mockResolvedValue(null);
  mocks.reclaim.mockReset().mockResolvedValue(0);
  mocks.stop.mockReset().mockResolvedValue(true);
  mocks.retry.mockReset().mockResolvedValue(true);
  mocks.reset.mockReset().mockResolvedValue(true);
  mocks.getUnit.mockReset().mockResolvedValue(null);
  mocks.schedule.mockReset();
});

afterEach(() => {
  if (originalEnv.databaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.gatewayApiKey == null) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = originalEnv.gatewayApiKey;
  if (originalEnv.oidcToken == null) delete process.env.VERCEL_OIDC_TOKEN;
  else process.env.VERCEL_OIDC_TOKEN = originalEnv.oidcToken;
});

describe("reading-agent actions API", () => {
  it("returns 503 when the database is not configured", async () => {
    delete process.env.DATABASE_URL;
    const response = await action({ request: request({ action: "start" }) });
    expect(response.status).toBe(503);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await action({
      request: request({ action: "reset", unitId: "unit-1" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  it("returns 409 when the Gateway or schema is unavailable", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    expect((await action({ request: request({ action: "start" }) })).status).toBe(409);

    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    mocks.schema.mockResolvedValue({
      ok: false,
      missingColumns: ["reading_ingest_unit.next_attempt_at"],
    });
    const response = await action({ request: request({ action: "start" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "schema_stale" });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("starts with Gateway credentials", async () => {
    const response = await action({ request: request({ action: "start" }) });
    expect(response.status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledWith("user-1");
  });

  it("stops a leased unit without incrementing attempts", async () => {
    mocks.lease.mockResolvedValue({
      unitId: "unit-1",
      bookId: "book-1",
      expiresAt: new Date("2026-01-01T00:05:00Z"),
      chapterLabel: "Chapter 1",
      locator: "chapter-1.xhtml",
    });

    const response = await action({ request: request({ action: "stop" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      stopped: true,
      unitId: "unit-1",
    });
    expect(mocks.stop).toHaveBeenCalledWith("user-1", "unit-1");
    expect(mocks.reclaim).not.toHaveBeenCalled();
  });

  it("stops a unit from an expired current lease", async () => {
    mocks.lease.mockResolvedValue({
      unitId: "unit-expired",
      bookId: "book-expired",
      expiresAt: new Date(0),
      chapterLabel: "Chapter 14",
      locator: "chapter-14.xhtml",
    });

    const response = await action({ request: request({ action: "stop" }) });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      stopped: true,
      unitId: "unit-expired",
    });
    expect(mocks.stop).toHaveBeenCalledWith("user-1", "unit-expired");
    expect(mocks.reclaim).not.toHaveBeenCalled();
  });

  it("returns stopped:false when there is no current lease", async () => {
    const response = await action({ request: request({ action: "stop" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, stopped: false });
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.reclaim).toHaveBeenCalledWith("user-1");
  });

  it("reclaims expired work then schedules a drain on start", async () => {
    const response = await action({ request: request({ action: "start" }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.reclaim).toHaveBeenCalledWith("user-1");
    expect(mocks.schedule).toHaveBeenCalledWith("user-1");
  });

  it("retries a pending unit immediately", async () => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status: "pending",
      attemptCount: 1,
      nextAttemptAt: new Date("2026-01-01T01:00:00Z"),
      claimedAt: null,
      lastError: null,
    });

    const response = await action({ request: request({ action: "retry", unitId: "unit-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledWith("user-1", "unit-1");
    expect(mocks.schedule).toHaveBeenCalledWith("user-1");
  });

  it("returns 404 when retrying a missing unit", async () => {
    const response = await action({ request: request({ action: "retry", unitId: "missing" }) });
    expect(response.status).toBe(404);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("returns 404 when retrying another user's unit", async () => {
    mocks.getUnit.mockResolvedValue(null);
    const response = await action({ request: request({ action: "retry", unitId: "unit-2" }) });
    expect(response.status).toBe(404);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("retries a processing unit directly", async () => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status: "processing",
      attemptCount: 2,
      nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
      claimedAt: new Date("2026-01-01T00:01:00Z"),
      lastError: null,
    });
    const response = await action({ request: request({ action: "retry", unitId: "unit-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledWith("user-1", "unit-1");
    expect(mocks.schedule).toHaveBeenCalledWith("user-1");
  });

  it("returns 409 when retrying a done or skipped unit", async () => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status: "done",
      attemptCount: 1,
      nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
      claimedAt: null,
      lastError: null,
    });

    const response = await action({ request: request({ action: "retry", unitId: "unit-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.retry).not.toHaveBeenCalled();
  });

  it("resets an 8/8 pending unit without scheduling a drain", async () => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status: "pending",
      attemptCount: 8,
      nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
      claimedAt: null,
      lastError: "Maximum attempts reached",
    });

    const response = await action({ request: request({ action: "reset", unitId: "unit-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith("user-1", "unit-1");
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("returns 404 when resetting another user's unit", async () => {
    const response = await action({ request: request({ action: "reset", unitId: "unit-2" }) });
    expect(response.status).toBe(404);
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("resets a processing unit directly", async () => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status: "processing",
      attemptCount: 8,
      nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
      claimedAt: new Date("2026-01-01T00:01:00Z"),
      lastError: null,
    });
    const response = await action({ request: request({ action: "reset", unitId: "unit-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith("user-1", "unit-1");
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each(["done", "skipped"] as const)("returns 409 when resetting a %s unit", async (status) => {
    mocks.getUnit.mockResolvedValue({
      id: "unit-1",
      bookId: "book-1",
      status,
      attemptCount: 8,
      nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
      claimedAt: null,
      lastError: null,
    });

    const response = await action({ request: request({ action: "reset", unitId: "unit-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
