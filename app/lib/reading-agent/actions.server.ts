import {
  getCurrentReadingAgentLease,
  getReadingIngestUnitForUser,
  resetReadingIngestUnit,
  retryReadingIngestUnit,
  stopReadingIngestUnit,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  reclaimStaleReadingAgentLease,
  scheduleReadingIngestQueue,
} from "~/lib/reading-agent/dispatch.server";

type QueueAction = "start" | "stop" | "retry" | "reset";

export type ReadingAgentActionPayload =
  | { action: "start" | "stop" }
  | { action: "retry" | "reset"; unitId: string };

export async function executeReadingAgentAction(
  userId: string,
  payload: ReadingAgentActionPayload,
): Promise<Response> {
  switch (payload.action) {
    case "start":
      return startQueue(userId);
    case "stop":
      return stopQueue(userId);
    case "retry":
      return retryUnit(userId, payload.unitId);
    case "reset":
      return resetUnit(userId, payload.unitId);
  }
}

async function startQueue(userId: string): Promise<Response> {
  await reclaimStaleReadingAgentLease(userId);
  scheduleReadingIngestQueue(userId);
  return Response.json({ ok: true });
}

async function stopQueue(userId: string): Promise<Response> {
  const lease = await getCurrentReadingAgentLease(userId);
  if (!lease) {
    await reclaimStaleReadingAgentLease(userId);
    return Response.json({ ok: true, stopped: false });
  }

  await stopReadingIngestUnit(userId, lease.unitId);
  return Response.json({ ok: true, stopped: true, unitId: lease.unitId });
}

async function retryUnit(userId: string, unitId: string): Promise<Response> {
  const unit = await getReadingIngestUnitForUser(userId, unitId);
  if (!unit) return Response.json({ error: "not_found" }, { status: 404 });
  if (unit.status === "done" || unit.status === "skipped") {
    return Response.json({ error: "not_retryable", status: unit.status }, { status: 409 });
  }

  await retryReadingIngestUnit(userId, unit.id);
  scheduleReadingIngestQueue(userId);
  return Response.json({ ok: true, unitId: unit.id });
}

async function resetUnit(userId: string, unitId: string): Promise<Response> {
  const unit = await getReadingIngestUnitForUser(userId, unitId);
  if (!unit) return Response.json({ error: "not_found" }, { status: 404 });
  if (unit.status === "done" || unit.status === "skipped") {
    return Response.json({ error: "not_resettable", status: unit.status }, { status: 409 });
  }

  await resetReadingIngestUnit(userId, unit.id);
  return Response.json({ ok: true, unitId: unit.id });
}

export function parseReadingAgentActionPayload(
  body: unknown,
): ReadingAgentActionPayload | { error: string } {
  if (!isRecord(body) || !isQueueAction(body.action)) return { error: "invalid_action" };
  if (body.action === "start" || body.action === "stop") return { action: body.action };
  if (typeof body.unitId !== "string" || body.unitId.trim() === "") {
    return { error: "unit_id_required" };
  }
  return { action: body.action, unitId: body.unitId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQueueAction(value: unknown): value is QueueAction {
  return value === "start" || value === "stop" || value === "retry" || value === "reset";
}
