import { requireAdminToken } from "~/lib/database/admin-auth";
import {
  BUG_REPORT_STATUSES,
  listBugReports,
  updateBugReport,
  type BugReportStatus,
} from "~/lib/database/bug-report/bug-report";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface PatchBody {
  id?: unknown;
  status?: unknown;
  notes?: unknown;
}

export async function loader({ request }: { request: Request }) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  requireAdminToken(request);

  const url = new URL(request.url);
  const statusesResult = parseStatuses(url.searchParams.getAll("status"));
  if (statusesResult.error) {
    return Response.json({ error: statusesResult.error }, { status: 400 });
  }

  const limit = parseIntegerParam(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const { rows, count } = await listBugReports({
    statuses: statusesResult.statuses.length > 0 ? statusesResult.statuses : undefined,
    q,
    limit,
    offset,
  });

  return Response.json({ reports: rows, count, limit, offset });
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "PATCH") {
    return methodNotAllowed();
  }

  requireAdminToken(request);

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const hasStatus = Object.hasOwn(body, "status");
  const hasNotes = Object.hasOwn(body, "notes");
  if (!id || (!hasStatus && !hasNotes)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const data: { status?: BugReportStatus; notes?: string | null } = {};
  if (hasStatus) {
    const status = typeof body.status === "string" ? normalizeStatus(body.status) : null;
    if (!status) {
      return Response.json({ error: "invalid_status" }, { status: 400 });
    }
    data.status = status;
  }

  if (hasNotes) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return Response.json({ error: "invalid_notes" }, { status: 400 });
    }
    data.notes = body.notes;
  }

  const report = await updateBugReport(id, data);
  if (!report) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(report);
}

function parseStatuses(values: string[]): { statuses: BugReportStatus[]; error?: string } {
  const statuses: BugReportStatus[] = [];
  for (const value of values.flatMap((item) => item.split(","))) {
    if (!value) continue;
    const status = normalizeStatus(value);
    if (!status) {
      return { statuses: [], error: "invalid_status" };
    }
    statuses.push(status);
  }
  return { statuses: [...new Set(statuses)] };
}

function normalizeStatus(status: string): BugReportStatus | null {
  const normalized = status.trim() === "in-progress" ? "in_progress" : status.trim();
  if (BUG_REPORT_STATUSES.includes(normalized as BugReportStatus)) {
    return normalized as BugReportStatus;
  }
  return null;
}

function parseIntegerParam(
  value: string | null,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function methodNotAllowed(): Response {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET, PATCH" } });
}
