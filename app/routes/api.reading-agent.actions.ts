import { createFlueClient } from "@flue/sdk";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  getLiveReadingAgentLease,
  getReadingAgentSchemaHealth,
  getReadingIngestUnitForUser,
  reclaimExpiredReadingAgentLease,
  retryReadingIngestUnit,
  stopReadingIngestUnit,
} from "~/lib/database/reading-artifact/reading-artifact";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";
import { scheduleReadingIngestQueue } from "~/lib/reading-agent/dispatch.server";

type QueueAction = "start" | "stop" | "retry";

export async function action({ request }: { request: Request }): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const sidecarConfigured = Boolean(
    process.env.READING_AGENT_URL && process.env.READING_AGENT_SECRET,
  );
  if (!sidecarConfigured) {
    return Response.json({ error: "sidecar_not_configured" }, { status: 409 });
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

  switch (payload.action) {
    case "start":
      return startQueue(session.userId);
    case "stop":
      return stopQueue(session.userId);
    case "retry":
      return retryUnit(session.userId, payload.unitId);
  }
}

async function startQueue(userId: string): Promise<Response> {
  await reclaimExpiredReadingAgentLease(userId);
  scheduleReadingIngestQueue(userId);
  return Response.json({ ok: true });
}

async function stopQueue(userId: string): Promise<Response> {
  const lease = await getLiveReadingAgentLease(userId);
  if (!lease) {
    await reclaimExpiredReadingAgentLease(userId);
    return Response.json({ ok: true, stopped: false });
  }

  await abortConversation(userId, lease.bookId);
  await stopReadingIngestUnit(userId, lease.unitId);
  return Response.json({ ok: true, stopped: true, unitId: lease.unitId });
}

async function retryUnit(userId: string, unitId: string): Promise<Response> {
  const unit = await getReadingIngestUnitForUser(userId, unitId);
  if (!unit) return Response.json({ error: "not_found" }, { status: 404 });
  if (unit.status === "done" || unit.status === "skipped") {
    return Response.json({ error: "not_retryable", status: unit.status }, { status: 409 });
  }

  if (unit.status === "processing") {
    const lease = await getLiveReadingAgentLease(userId);
    if (lease?.unitId === unit.id) await abortConversation(userId, lease.bookId);
  }

  await retryReadingIngestUnit(userId, unit.id);
  scheduleReadingIngestQueue(userId);
  return Response.json({ ok: true, unitId: unit.id });
}

async function abortConversation(userId: string, bookId: string): Promise<void> {
  const agentUrl = process.env.READING_AGENT_URL;
  const secret = process.env.READING_AGENT_SECRET;
  if (!agentUrl || !secret) return;

  try {
    const client = createFlueClient({
      url: `${agentUrl.replace(/\/+$/, "")}/${readingConversationId(userId, bookId)}`,
      token: secret,
    });
    await client.abort();
  } catch (error) {
    console.error("[reading-agent] Failed to abort Flue conversation:", error);
  }
}

async function parseActionPayload(
  request: Request,
): Promise<{ action: "start" | "stop" } | { action: "retry"; unitId: string } | { error: string }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "invalid_json" };
  }
  if (!isRecord(body) || !isQueueAction(body.action)) return { error: "invalid_action" };
  if (body.action !== "retry") return { action: body.action };
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") {
    return { error: "unit_id_required" };
  }
  return { action: "retry", unitId: body.unitId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQueueAction(value: unknown): value is QueueAction {
  return value === "start" || value === "stop" || value === "retry";
}
