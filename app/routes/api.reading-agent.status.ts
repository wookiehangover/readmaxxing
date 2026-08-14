import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  getCurrentReadingAgentLease,
  getLatestReadingAgentUsage,
  getReadingAgentSchemaHealth,
  listRecentReadingIngestUnits,
  type ReadingAgentUsageRow,
} from "~/lib/database/reading-artifact/reading-artifact";

function serializeUsage(usage: ReadingAgentUsageRow | null) {
  if (!usage) return null;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    model: usage.model,
    source: usage.source,
    createdAt: usage.createdAt,
  };
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const sidecarConfigured = Boolean(
    process.env.READING_AGENT_URL && process.env.READING_AGENT_SECRET,
  );
  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) {
    return Response.json({ sidecarConfigured, schema, lease: null, units: [], usage: null });
  }

  const bookId = new URL(request.url).searchParams.get("bookId") || undefined;
  const [lease, units, usage] = await Promise.all([
    getCurrentReadingAgentLease(session.userId),
    listRecentReadingIngestUnits({ userId: session.userId, bookId }),
    getLatestReadingAgentUsage(session.userId),
  ]);
  return Response.json({ sidecarConfigured, schema, lease, units, usage: serializeUsage(usage) });
}
