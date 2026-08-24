import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  clearReadingArtifactsAndIngestForUser,
  getCurrentReadingAgentLease,
  getLatestReadingAgentUsage,
  getLatestReadingPageIncrementRevision,
  getReadingAgentSchemaHealth,
  listRecentReadingIngestUnits,
  type ReadingAgentSchemaHealth,
  type ReadingAgentUsageRow,
  type ReadingPageIncrementRevisionRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  getSelectedDebugModel,
  isDebugReadingAgentModel,
  setSelectedDebugModel,
} from "~/lib/reading-agent/debug-model.server";
import {
  executeReadingAgentAction,
  parseReadingAgentActionPayload,
} from "~/lib/reading-agent/actions.server";
import { getOutlineChapterBullets } from "~/lib/reading-agent/outline-merge";

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

function gatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

function serializeLatestIncrement(revision: ReadingPageIncrementRevisionRow | null) {
  if (!revision) return null;
  const previous = new Set(
    getOutlineChapterBullets(revision.previousContent ?? "", revision.chapterLabel),
  );
  const bullets = getOutlineChapterBullets(revision.content, revision.chapterLabel).filter(
    (bullet) => !previous.has(bullet),
  );
  if (bullets.length === 0) return null;
  return {
    chapterLabel: revision.chapterLabel?.trim() || "Untitled",
    bullets,
    createdAt: revision.createdAt,
  };
}

async function authorize(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });
  return { userId: session.userId };
}

async function loadSnapshot(
  userId: string,
  knownSchema?: ReadingAgentSchemaHealth,
): Promise<Response> {
  const schema = knownSchema ?? (await getReadingAgentSchemaHealth());
  const base = {
    gatewayConfigured: gatewayConfigured(),
    schema,
    selectedModel: getSelectedDebugModel(),
  };
  if (!schema.ok) {
    return Response.json({
      ...base,
      lease: null,
      units: [],
      usage: null,
      latestIncrement: null,
      lastError: null,
    });
  }

  const [lease, units, usage, latestIncrement] = await Promise.all([
    getCurrentReadingAgentLease(userId),
    listRecentReadingIngestUnits({ userId }),
    getLatestReadingAgentUsage(userId),
    getLatestReadingPageIncrementRevision(userId),
  ]);

  return Response.json({
    ...base,
    lease,
    units,
    usage: serializeUsage(usage),
    latestIncrement: serializeLatestIncrement(latestIncrement),
    lastError: units.find((unit) => unit.lastError)?.lastError ?? null,
  });
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }
  const access = await authorize(request);
  if (access instanceof Response) return access;
  return loadSnapshot(access.userId);
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
  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) {
    return Response.json(
      { error: "schema_stale", schema, missingColumns: schema.missingColumns ?? [] },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (isRecord(body) && body.action === "clear") {
    await clearReadingArtifactsAndIngestForUser(access.userId);
    return loadSnapshot(access.userId, schema);
  }
  if (isRecord(body) && body.action === undefined && body.model !== undefined) {
    if (!isDebugReadingAgentModel(body.model)) {
      return Response.json({ error: "invalid_model" }, { status: 400 });
    }
    setSelectedDebugModel(body.model);
    return loadSnapshot(access.userId, schema);
  }

  const payload = parseReadingAgentActionPayload(body);
  if ("error" in payload) return Response.json({ error: payload.error }, { status: 400 });
  if (!gatewayConfigured()) {
    return Response.json({ error: "gateway_not_configured" }, { status: 409 });
  }

  if (isRecord(body) && body.model !== undefined) {
    if (!isDebugReadingAgentModel(body.model)) {
      return Response.json({ error: "invalid_model" }, { status: 400 });
    }
    setSelectedDebugModel(body.model);
  }

  const result = await executeReadingAgentAction(access.userId, payload);
  if (!result.ok) return result;
  return loadSnapshot(access.userId, schema);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
