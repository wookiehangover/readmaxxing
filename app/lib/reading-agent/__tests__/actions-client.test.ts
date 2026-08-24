import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postReadingAgentAction, readingAgentActionAvailability } from "../actions-client";

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading agent action client", () => {
  it("disables actions when the Gateway or schema is unavailable", () => {
    const lease = { expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(
      readingAgentActionAvailability({
        gatewayConfigured: true,
        schema: { ok: true },
        lease: null,
      }),
    ).toEqual({ canStart: true, canStop: false, canRetry: true, canReset: true });
    expect(
      readingAgentActionAvailability({
        gatewayConfigured: true,
        schema: { ok: true },
        lease,
      }),
    ).toEqual({ canStart: false, canStop: true, canRetry: true, canReset: true });
    expect(
      readingAgentActionAvailability({
        gatewayConfigured: false,
        schema: { ok: true },
        lease,
      }),
    ).toEqual({ canStart: false, canStop: false, canRetry: false, canReset: false });
    expect(
      readingAgentActionAvailability({
        gatewayConfigured: true,
        schema: { ok: false },
        lease,
      }),
    ).toEqual({ canStart: false, canStop: false, canRetry: false, canReset: false });
  });

  it("allows Stop but not Start for a current one-shot lease", () => {
    expect(
      readingAgentActionAvailability({
        gatewayConfigured: true,
        schema: { ok: true },
        lease: { expiresAt: "2099-01-01T00:00:00.000Z" },
      }),
    ).toEqual({ canStart: false, canStop: true, canRetry: true, canReset: true });
  });

  it("posts start and surfaces Gateway errors", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await postReadingAgentAction({ action: "start" });
    expect(fetchMock).toHaveBeenCalledWith("/api/reading-agent/actions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "gateway_not_configured" }, { status: 409 }),
    );
    await expect(postReadingAgentAction({ action: "stop" })).rejects.toThrow(
      "AI Gateway is not configured.",
    );
  });

  it("posts a unit reset", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await postReadingAgentAction({ action: "reset", unitId: "unit-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reading-agent/actions",
      expect.objectContaining({ body: JSON.stringify({ action: "reset", unitId: "unit-1" }) }),
    );
  });

  it("posts the user-scoped clear action to the debug endpoint", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    await postReadingAgentAction({ action: "clear" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reading-agent/debug",
      expect.objectContaining({ body: JSON.stringify({ action: "clear" }) }),
    );
  });
});
