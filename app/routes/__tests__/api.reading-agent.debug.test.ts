import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  schema: vi.fn(),
  lease: vi.fn(),
  units: vi.fn(),
  usage: vi.fn(),
  increment: vi.fn(),
  activeHost: vi.fn(),
  clear: vi.fn(),
  createFlueClient: vi.fn(),
  selectedModel: "anthropic/claude-sonnet-4-6",
  getSelectedModel: vi.fn(),
  isDebugModel: vi.fn(),
  setSelectedModel: vi.fn(),
  parseAction: vi.fn(),
  executeAction: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ getSessionFromRequest: mocks.auth }));
vi.mock("~/lib/database/reading-artifact/reading-artifact", () => ({
  clearReadingArtifactsAndIngestForUser: mocks.clear,
  getReadingAgentSchemaHealth: mocks.schema,
  getCurrentReadingAgentLease: mocks.lease,
  listRecentReadingIngestUnits: mocks.units,
  getLatestReadingAgentUsage: mocks.usage,
  getLatestReadingPageIncrementRevision: mocks.increment,
}));
vi.mock("~/lib/reading-agent/agent-host.server", () => ({
  getActiveReadingAgentHost: mocks.activeHost,
}));
vi.mock("@flue/sdk", () => ({ createFlueClient: mocks.createFlueClient }));
vi.mock("~/lib/reading-agent/debug-model.server", () => ({
  getSelectedDebugModel: mocks.getSelectedModel,
  isDebugReadingAgentModel: mocks.isDebugModel,
  setSelectedDebugModel: mocks.setSelectedModel,
}));
vi.mock("~/routes/api.reading-agent.actions", () => ({
  parseReadingAgentActionPayload: mocks.parseAction,
  executeReadingAgentAction: mocks.executeAction,
}));

import { action, loader } from "~/routes/api.reading-agent.debug";

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  gatewayApiKey: process.env.AI_GATEWAY_API_KEY,
  oidcToken: process.env.VERCEL_OIDC_TOKEN,
};

function getRequest(): Request {
  return new Request("http://localhost/api/reading-agent/debug");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/reading-agent/debug", {
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
  mocks.units.mockReset().mockResolvedValue([]);
  mocks.usage.mockReset().mockResolvedValue(null);
  mocks.increment.mockReset().mockResolvedValue(null);
  mocks.activeHost.mockReset().mockReturnValue(undefined);
  mocks.clear.mockReset().mockResolvedValue(undefined);
  mocks.createFlueClient.mockReset();
  mocks.selectedModel = "anthropic/claude-sonnet-4-6";
  mocks.getSelectedModel.mockReset().mockImplementation(() => mocks.selectedModel);
  mocks.isDebugModel
    .mockReset()
    .mockImplementation((value: unknown) =>
      [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.5",
        "xai/grok-4.5",
        "google/gemini-2.5-flash",
      ].includes(String(value)),
    );
  mocks.setSelectedModel.mockReset().mockImplementation((value: string) => {
    mocks.selectedModel = value;
    return value;
  });
  mocks.parseAction.mockReset().mockImplementation((body: { action?: string; unitId?: string }) => {
    if (body.action === "start" || body.action === "stop") return { action: body.action };
    if ((body.action === "retry" || body.action === "reset") && body.unitId) {
      return { action: body.action, unitId: body.unitId };
    }
    return { error: "invalid_action" };
  });
  mocks.executeAction.mockReset().mockResolvedValue(Response.json({ ok: true }));
});

afterEach(() => {
  if (originalEnv.databaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalEnv.databaseUrl;
  if (originalEnv.gatewayApiKey == null) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = originalEnv.gatewayApiKey;
  if (originalEnv.oidcToken == null) delete process.env.VERCEL_OIDC_TOKEN;
  else process.env.VERCEL_OIDC_TOKEN = originalEnv.oidcToken;
});

describe("reading-agent debug API", () => {
  it("returns 401 before reading debug state for an unsigned request", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await loader({ request: getRequest() });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
    expect(mocks.schema).not.toHaveBeenCalled();
    expect(mocks.activeHost).not.toHaveBeenCalled();
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("does not clear stored data for an unsigned request", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await action({ request: postRequest({ action: "clear" }) });

    expect(response.status).toBe(401);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("reports Gateway readiness and stale schema without reading queue tables", async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const unconfigured = await loader({ request: getRequest() });
    expect(unconfigured.status).toBe(200);
    await expect(unconfigured.json()).resolves.toMatchObject({ gatewayConfigured: false });
    mocks.lease.mockClear();

    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    mocks.schema.mockResolvedValue({ ok: false, missingColumns: ["reading_agent_lease.unit_id"] });
    const stale = await loader({ request: getRequest() });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toEqual({
      gatewayConfigured: true,
      schema: { ok: false, missingColumns: ["reading_agent_lease.unit_id"] },
      selectedModel: "anthropic/claude-sonnet-4-6",
      lease: null,
      units: [],
      usage: null,
      latestIncrement: null,
      lastError: null,
    });
    expect(mocks.lease).not.toHaveBeenCalled();
  });

  it("returns status, usage, selected model, last error, and the latest page increment", async () => {
    mocks.lease.mockResolvedValue({
      unitId: "unit-1",
      bookId: "book-1",
      expiresAt: new Date("2026-08-16T07:00:00Z"),
      chapterLabel: "Chapter 1",
      locator: "chapter-1.xhtml",
    });
    mocks.units.mockResolvedValue([
      { unitId: "unit-1", bookId: "book-1", lastError: "Previous attempt failed" },
    ]);
    mocks.usage.mockResolvedValue({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 18,
      model: "openai/gpt-5.5",
      source: "provider",
      createdAt: new Date("2026-08-16T06:00:00Z"),
    });
    mocks.increment.mockResolvedValue({
      chapterLabel: "Chapter 1",
      previousContent: "## Chapter 1\n- The traveler leaves home.",
      content:
        "## Chapter 1\n- The traveler leaves home.\n- A storm closes the mountain pass.\n- The innkeeper offers shelter.",
      createdAt: new Date("2026-08-16T06:00:01Z"),
    });

    const response = await loader({ request: getRequest() });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      gatewayConfigured: true,
      schema: { ok: true },
      selectedModel: "anthropic/claude-sonnet-4-6",
      lastError: "Previous attempt failed",
      usage: { model: "openai/gpt-5.5", totalTokens: 18 },
    });
    expect(body.latestIncrement).toEqual({
      chapterLabel: "Chapter 1",
      bullets: ["A storm closes the mountain pass.", "The innkeeper offers shelter."],
      createdAt: "2026-08-16T06:00:01.000Z",
    });
    expect(mocks.activeHost).not.toHaveBeenCalled();
    expect(mocks.createFlueClient).not.toHaveBeenCalled();
  });

  it("sets an optional model, runs the shared action, and returns a fresh snapshot", async () => {
    mocks.units.mockResolvedValue([{ unitId: "unit-1", lastError: null }]);

    const response = await action({
      request: postRequest({ action: "retry", unitId: "unit-1", model: "xai/grok-4.5" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.setSelectedModel).toHaveBeenCalledWith("xai/grok-4.5");
    expect(mocks.executeAction).toHaveBeenCalledWith("user-1", {
      action: "retry",
      unitId: "unit-1",
    });
    expect(mocks.setSelectedModel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.executeAction.mock.invocationCallOrder[0]!,
    );
    await expect(response.json()).resolves.toMatchObject({
      gatewayConfigured: true,
      selectedModel: "xai/grok-4.5",
    });
    expect(mocks.units).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it("clears only the authenticated user's stored artifacts and ingest history", async () => {
    const response = await action({ request: postRequest({ action: "clear" }) });

    expect(response.status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledWith("user-1");
    expect(mocks.parseAction).not.toHaveBeenCalled();
    expect(mocks.executeAction).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      lease: null,
      units: [],
      usage: null,
      latestIncrement: null,
    });
  });

  it("sets a model without triggering a queue action", async () => {
    const response = await action({
      request: postRequest({ model: "google/gemini-2.5-flash" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.setSelectedModel).toHaveBeenCalledWith("google/gemini-2.5-flash");
    expect(mocks.parseAction).not.toHaveBeenCalled();
    expect(mocks.executeAction).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      selectedModel: "google/gemini-2.5-flash",
    });
  });

  it("rejects an invalid model without running an action or changing selection", async () => {
    const response = await action({
      request: postRequest({ action: "start", model: "unknown/model" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_model" });
    expect(mocks.setSelectedModel).not.toHaveBeenCalled();
    expect(mocks.executeAction).not.toHaveBeenCalled();

    const snapshot = await loader({ request: getRequest() });
    await expect(snapshot.json()).resolves.toMatchObject({
      selectedModel: "anthropic/claude-sonnet-4-6",
    });
  });

  it("does not run queue actions without Gateway credentials", async () => {
    delete process.env.AI_GATEWAY_API_KEY;

    const response = await action({ request: postRequest({ action: "start" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "gateway_not_configured" });
    expect(mocks.executeAction).not.toHaveBeenCalled();
  });

  it("preserves shared action errors instead of returning a misleading snapshot", async () => {
    mocks.executeAction.mockResolvedValue(Response.json({ error: "not_found" }, { status: 404 }));

    const response = await action({
      request: postRequest({ action: "retry", unitId: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
    expect(mocks.lease).not.toHaveBeenCalled();
  });
});
