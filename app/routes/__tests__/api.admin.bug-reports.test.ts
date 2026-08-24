import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/database/bug-report/bug-report", () => ({
  BUG_REPORT_STATUSES: ["new", "triaged", "in_progress", "resolved", "closed", "wont_fix"],
  listBugReports: vi.fn(async () => ({ rows: [], count: 0 })),
  updateBugReport: vi.fn(async () => null),
}));

import { listBugReports, updateBugReport } from "~/lib/database/bug-report/bug-report";
import { action, loader } from "~/routes/api.admin.bug-reports";

const listBugReportsMock = listBugReports as ReturnType<typeof vi.fn>;
const updateBugReportMock = updateBugReport as ReturnType<typeof vi.fn>;
const originalAdminToken = process.env.ADMIN_API_TOKEN;

const report = {
  id: "report-1",
  userId: "user-1",
  message: "Reader crashed",
  context: { route: "/book" },
  notes: "Needs triage",
  status: "new",
  groupId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.ADMIN_API_TOKEN = "admin-secret";
  listBugReportsMock.mockReset();
  listBugReportsMock.mockResolvedValue({ rows: [], count: 0 });
  updateBugReportMock.mockReset();
  updateBugReportMock.mockResolvedValue(null);
});

afterEach(() => {
  if (originalAdminToken == null) {
    delete process.env.ADMIN_API_TOKEN;
  } else {
    process.env.ADMIN_API_TOKEN = originalAdminToken;
  }
});

function makeRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      Authorization: "Bearer admin-secret",
      ...init.headers,
    },
  });
}

async function resolveResponse(result: Promise<Response>): Promise<Response> {
  try {
    return await result;
  } catch (cause) {
    if (cause instanceof Response) return cause;
    throw cause;
  }
}

describe("admin bug reports API", () => {
  it("returns 503 when the admin token is unset", async () => {
    delete process.env.ADMIN_API_TOKEN;

    const response = await resolveResponse(
      loader({ request: makeRequest("http://localhost/api/admin/bug-reports") }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "not_configured" });
    expect(listBugReportsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is invalid", async () => {
    const response = await resolveResponse(
      loader({
        request: makeRequest("http://localhost/api/admin/bug-reports", {
          headers: { Authorization: "Bearer wrong-token" },
        }),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "admin_auth_required" });
    expect(listBugReportsMock).not.toHaveBeenCalled();
  });

  it("lists and searches bug reports", async () => {
    listBugReportsMock.mockResolvedValue({ rows: [report], count: 1 });

    const response = await loader({
      request: makeRequest(
        "http://localhost/api/admin/bug-reports?status=in-progress&q=crash&limit=25&offset=10",
      ),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reports: [report],
      count: 1,
      limit: 25,
      offset: 10,
    });
    expect(listBugReportsMock).toHaveBeenCalledWith({
      statuses: ["in_progress"],
      q: "crash",
      limit: 25,
      offset: 10,
    });
  });

  it("patches status and notes", async () => {
    const updatedReport = { ...report, status: "resolved", notes: "Fixed in latest release" };
    updateBugReportMock.mockResolvedValue(updatedReport);

    const response = await action({
      request: makeRequest("http://localhost/api/admin/bug-reports", {
        method: "PATCH",
        body: JSON.stringify({
          id: "report-1",
          status: "resolved",
          notes: "Fixed in latest release",
        }),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(updatedReport);
    expect(updateBugReportMock).toHaveBeenCalledWith("report-1", {
      status: "resolved",
      notes: "Fixed in latest release",
    });
  });

  it("returns 404 when patch target is not found", async () => {
    const response = await action({
      request: makeRequest("http://localhost/api/admin/bug-reports", {
        method: "PATCH",
        body: JSON.stringify({ id: "missing-report", notes: "No row" }),
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns 400 for an invalid status", async () => {
    const response = await loader({
      request: makeRequest("http://localhost/api/admin/bug-reports?status=bogus"),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_status" });
    expect(listBugReportsMock).not.toHaveBeenCalled();
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action({
      request: makeRequest("http://localhost/api/admin/bug-reports", { method: "POST" }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, PATCH");
  });
});
