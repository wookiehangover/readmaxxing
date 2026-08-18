import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getReadingAgentSchemaHealth } from "~/lib/database/reading-artifact/reading-artifact";
import {
  executeReadingAgentAction,
  parseReadingAgentActionPayload,
  type ReadingAgentActionPayload,
} from "~/lib/reading-agent/actions.server";

export async function action({ request }: { request: Request }): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    return Response.json({ error: "gateway_not_configured" }, { status: 409 });
  }

  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) {
    return Response.json(
      { error: "schema_stale", missingColumns: schema.missingColumns ?? [] },
      { status: 409 },
    );
  }

  const payload = await parseActionPayload(request);
  if ("error" in payload) return Response.json({ error: payload.error }, { status: 400 });

  return executeReadingAgentAction(session.userId, payload);
}

async function parseActionPayload(
  request: Request,
): Promise<ReadingAgentActionPayload | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "invalid_json" };
  }
  return parseReadingAgentActionPayload(body);
}
