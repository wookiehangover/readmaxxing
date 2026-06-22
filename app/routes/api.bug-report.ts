import { requireAuth } from "~/lib/database/auth-middleware";
import { insertBugReport } from "~/lib/database/bug-report/bug-report";

const MAX_MESSAGE_LENGTH = 5000;

interface BugReportRequestBody {
  message?: unknown;
  context?: unknown;
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  let body: BugReportRequestBody;
  try {
    body = (await request.json()) as BugReportRequestBody;
  } catch {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  let context: Record<string, unknown> | null = null;
  if (body.context != null) {
    if (!isRecord(body.context)) {
      return Response.json({ error: "invalid_context" }, { status: 400 });
    }
    context = body.context;
  }

  const report = await insertBugReport({
    userId,
    message,
    context,
  });

  if (!report) {
    return Response.json({ error: "failed_to_create" }, { status: 500 });
  }

  return Response.json({ id: report.id }, { status: 201 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
