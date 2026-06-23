const ADMIN_API_DOC = `# Readmax Admin Bug Reports API

This public llms.txt file describes the admin bug-reports API for LLM agents.
The bug-reports endpoints themselves require this header:

Authorization: Bearer <ADMIN_API_TOKEN>

## GET /api/admin/bug-reports

List bug reports for triage.

Query params:
- status: optional status filter. May be repeated or comma-separated.
- q: optional text search over message and notes.
- limit: optional page size, defaults to 50, minimum 1, maximum 100.
- offset: optional page offset, defaults to 0.

Response shape:
{ reports, count, limit, offset }

Each report contains:
id, userId, message, context, notes, status, groupId, createdAt, updatedAt

## PATCH /api/admin/bug-reports

Update a bug report's status and/or notes.

JSON body:
{ id, status?, notes? }

Behavior:
- id is required.
- At least one of status or notes is required.
- status must be an allowed status value.
- notes may be a string or null.
- Returns 404 if the report is not found.
- Returns the updated report on success.

Allowed status values:
new, triaged, in_progress, resolved, closed, wont_fix

The API also accepts the alias in-progress and stores it as in_progress.

Workflow:
Triage each report, set the appropriate status, and record investigation or fix progress in notes.
`;

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  return new Response(ADMIN_API_DOC, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function action(): Promise<Response> {
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
}
