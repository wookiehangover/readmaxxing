import { createFlueClient } from "@flue/sdk";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  clearReadingArtifactsAndIngestForUser,
  getCurrentReadingAgentLease,
  getLatestReadingAgentUsage,
  getReadingAgentSchemaHealth,
  listRecentReadingIngestUnits,
  type ReadingAgentSchemaHealth,
  type ReadingAgentUsageRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import { sanitizeConversationMessages } from "~/lib/reading-agent/conversation";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";
import {
  getSelectedDebugModel,
  isDebugReadingAgentModel,
  setSelectedDebugModel,
} from "~/lib/reading-agent/debug-model.server";
import { getActiveReadingAgentHost } from "~/lib/reading-agent/agent-host.server";
import {
  executeReadingAgentAction,
  parseReadingAgentActionPayload,
} from "~/routes/api.reading-agent.actions";

const CONVERSATION_TAIL_SIZE = 20;

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

async function authorize(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  if (!process.env.READING_AGENT_SECRET) {
    return Response.json({ error: "agent_not_configured" }, { status: 409 });
  }

  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) {
    return Response.json(
      { error: "schema_stale", schema, missingColumns: schema.missingColumns ?? [] },
      { status: 409 },
    );
  }
  return { userId: session.userId, schema };
}

async function loadSnapshot(
  request: Request,
  userId: string,
  schema: ReadingAgentSchemaHealth,
): Promise<Response> {
  const [lease, units, usage] = await Promise.all([
    getCurrentReadingAgentLease(userId),
    listRecentReadingIngestUnits({ userId }),
    getLatestReadingAgentUsage(userId),
  ]);
  const conversationId = lease
    ? readingConversationId(userId, lease.bookId, lease.unitId)
    : undefined;
  const host = conversationId ? getActiveReadingAgentHost(conversationId) : undefined;
  let conversationTail = null;
  let conversationError: string | null = null;

  if (host) {
    const client = createFlueClient({
      url: host.url,
      token: process.env.READING_AGENT_SECRET!,
      ...(host.fetch ? { fetch: host.fetch } : {}),
    });
    try {
      const history = await client.history({ signal: request.signal });
      conversationTail = sanitizeConversationMessages(history.messages).slice(
        -CONVERSATION_TAIL_SIZE,
      );
    } catch (error) {
      if (request.signal.aborted) throw error;
      conversationError = "conversation_history_failed";
    }
  }

  return Response.json({
    hostConfigured: true,
    hostActive: Boolean(host),
    schema,
    lease,
    units,
    usage: serializeUsage(usage),
    conversationTail,
    selectedModel: getSelectedDebugModel(),
    lastError: units.find((unit) => unit.lastError)?.lastError ?? conversationError,
  });
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }
  const access = await authorize(request);
  if (access instanceof Response) return access;
  return loadSnapshot(request, access.userId, access.schema);
}

export async function action({ request }: { request: Request }): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }
  const access = await authorize(request);
  if (access instanceof Response) return access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (isRecord(body) && body.action === "clear") {
    await clearReadingArtifactsAndIngestForUser(access.userId);
    return loadSnapshot(request, access.userId, access.schema);
  }
  if (isRecord(body) && body.action === undefined && body.model !== undefined) {
    if (!isDebugReadingAgentModel(body.model)) {
      return Response.json({ error: "invalid_model" }, { status: 400 });
    }
    setSelectedDebugModel(body.model);
    return loadSnapshot(request, access.userId, access.schema);
  }

  const payload = parseReadingAgentActionPayload(body);
  if ("error" in payload) return Response.json({ error: payload.error }, { status: 400 });

  if (isRecord(body) && body.model !== undefined) {
    if (!isDebugReadingAgentModel(body.model)) {
      return Response.json({ error: "invalid_model" }, { status: 400 });
    }
    setSelectedDebugModel(body.model);
  }

  const result = await executeReadingAgentAction(access.userId, payload);
  if (!result.ok) return result;
  return loadSnapshot(request, access.userId, access.schema);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
