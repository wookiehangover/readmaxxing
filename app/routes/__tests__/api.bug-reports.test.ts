import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/auth-middleware", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("~/lib/database/bug-report/bug-report", () => ({
  listBugReports: vi.fn(async () => ({ rows: [], count: 0 })),
}));

import { requireAuth } from "~/lib/database/auth-middleware";
import { listBugReports } from "~/lib/database/bug-report/bug-report";
import { loader } from "~/routes/api.bug-reports";

const requireAuthMock = requireAuth as ReturnType<typeof vi.fn>;
const listBugReportsMock = listBugReports as ReturnType<typeof vi.fn>;
const originalDatabaseUrl = process.env.DATABASE_URL;

const report = {
  id: "report-1",
  userId: "user-1",
  message: "Reader crashed",
  context: { route: "/book" },
  notes: "Internal triage note",
  status: "new",
  groupId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://example";
  requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue({ userId: "user-1" });
  listBugReportsMock.mockReset();
  listBugReportsMock.mockResolvedValue({ rows: [], count: 0 });
});

afterEach(() => {
  if (originalDatabaseUrl == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

async function resolveResponse(result: Promise<Response>): Promise<Response> {
  try {
    return await result;
  } catch (cause) {
    if (cause instanceof Response) return cause;
    throw cause;
  }
}

describe("user bug reports API", () => {
  it("returns 503 when the database is unset", async () => {
    delete process.env.DATABASE_URL;

    const response = await resolveResponse(
      loader({ request: new Request("http://localhost/api/bug-reports") }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "not_configured" });
    expect(requireAuthMock).not.toHaveBeenCalled();
    expect(listBugReportsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    requireAuthMock.mockRejectedValue(Response.json({ error: "auth_required" }, { status: 401 }));

    const response = await resolveResponse(
      loader({ request: new Request("http://localhost/api/bug-reports") }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "auth_required" });
    expect(listBugReportsMock).not.toHaveBeenCalled();
  });

  it("returns the signed-in user's reports without internal fields", async () => {
    listBugReportsMock.mockResolvedValue({ rows: [report], count: 1 });

    const response = await loader({
      request: new Request("http://localhost/api/bug-reports?limit=25&offset=10"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reports: [
        {
          id: "report-1",
          message: "Reader crashed",
          status: "new",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      count: 1,
    });
    expect(listBugReportsMock).toHaveBeenCalledWith({ userId: "user-1", limit: 25, offset: 10 });
  });
});