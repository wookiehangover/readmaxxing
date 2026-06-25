import { requireAuth } from "~/lib/database/auth-middleware";
import { listBugReports } from "~/lib/database/bug-report/bug-report";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function loader({ request }: { request: Request }) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);
  const url = new URL(request.url);
  const limit = parseIntegerParam(url.searchParams.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = parseIntegerParam(url.searchParams.get("offset"), 0, 0);
  const { rows, count } = await listBugReports({ userId, limit, offset });

  return Response.json({
    reports: rows.map(({ id, message, status, createdAt, updatedAt }) => ({
      id,
      message,
      status,
      createdAt,
      updatedAt,
    })),
    count,
  });
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