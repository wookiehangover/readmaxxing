import { describe, expect, it } from "vitest";

import { action, loader } from "~/routes/api.admin.llms.txt";

describe("admin llms.txt API documentation", () => {
  it("returns public text documentation without auth", async () => {
    const response = await loader({
      request: new Request("http://localhost/api/admin/llms.txt"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");

    const body = await response.text();
    expect(body).toContain("Authorization: Bearer <ADMIN_API_TOKEN>");
    expect(body).toContain("GET /api/admin/bug-reports");
    expect(body).toContain("status");
    expect(body).toContain("q");
    expect(body).toContain("limit");
    expect(body).toContain("offset");
    expect(body).toContain("{ reports, count, limit, offset }");
    expect(body).toContain(
      "id, userId, message, context, notes, status, groupId, createdAt, updatedAt",
    );
    expect(body).toContain("PATCH /api/admin/bug-reports");
    expect(body).toContain("{ id, status?, notes? }");
    expect(body).toContain("new, triaged, in_progress, resolved, closed, wont_fix");
    expect(body).toContain("in-progress");
    expect(body).toContain("Triage each report");
  });

  it("returns 405 for unsupported methods", async () => {
    const response = await action();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});
