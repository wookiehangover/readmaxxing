import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  getCurrentReadingAgentLease,
  getLatestReadingAgentUsage,
  getReadingAgentSchemaHealth,
  listRecentReadingIngestUnits,
  type ReadingAgentUsageRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import { getActiveReadingAgentHost } from "~/lib/reading-agent/agent-host.server";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";

export const READING_AGENT_STATUS_TIMEOUT_MS = 3_000;

class ReadingAgentStatusTimeoutError extends Error {}

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

async function loadStatus(request: Request): Promise<Response> {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const hostConfigured = Boolean(process.env.READING_AGENT_SECRET);
  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) {
    return Response.json({
      hostConfigured,
      hostActive: false,
      schema,
      lease: null,
      units: [],
      usage: null,
    });
  }

  const bookId = new URL(request.url).searchParams.get("bookId") || undefined;
  const [lease, units, usage] = await Promise.all([
    getCurrentReadingAgentLease(session.userId),
    listRecentReadingIngestUnits({ userId: session.userId, bookId }),
    getLatestReadingAgentUsage(session.userId),
  ]);
  const hostActive = Boolean(
    lease && getActiveReadingAgentHost(readingConversationId(session.userId, lease.bookId)),
  );
  return Response.json({
    hostConfigured,
    hostActive,
    schema,
    lease,
    units,
    usage: serializeUsage(usage),
  });
}

async function withStatusTimeout<T>(operation: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new ReadingAgentStatusTimeoutError()),
          READING_AGENT_STATUS_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  try {
    return await withStatusTimeout(() => loadStatus(request));
  } catch (error) {
    if (error instanceof ReadingAgentStatusTimeoutError) {
      return Response.json({ error: "status_timeout" }, { status: 504 });
    }
    throw error;
  }
}
