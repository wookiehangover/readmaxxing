import { createHash } from "node:crypto";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  getReadingIngestUnitByFingerprint,
  insertReadingIngestUnit,
  type ReadingIngestUnitRow,
  type ReadingUnitKind,
} from "~/lib/database/reading-artifact/reading-artifact";
import { scheduleReadingIngestUnit } from "~/lib/reading-agent/dispatch.server";

const MIN_READING_TEXT_LENGTH = 20;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

interface IngestPayload {
  fingerprint: string;
  unitKind: ReadingUnitKind;
  locator: string;
  chapterLabel?: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeReadingText(text: string): string {
  return text.normalize("NFC").trim();
}

export function computeReadingFingerprint(data: {
  userId: string;
  bookId: string;
  unitKind: ReadingUnitKind;
  locator: string;
  text: string;
}): string {
  return createHash("sha256")
    .update(data.userId)
    .update(data.bookId)
    .update(data.unitKind)
    .update(data.locator)
    .update(normalizeReadingText(data.text))
    .digest("hex");
}

export function parseIngestPayload(value: unknown): IngestPayload | { error: string } {
  if (!isRecord(value)) return { error: "body must be an object" };
  if (typeof value.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(value.fingerprint)) {
    return { error: "fingerprint must be a lowercase hex SHA-256 value" };
  }
  if (value.unitKind !== "epub-spine" && value.unitKind !== "pdf-page") {
    return { error: "unitKind must be epub-spine or pdf-page" };
  }
  if (typeof value.locator !== "string" || value.locator.trim().length === 0) {
    return { error: "locator must be a non-empty string" };
  }
  if (typeof value.text !== "string") return { error: "text must be a string" };

  const text = normalizeReadingText(value.text);
  if (Array.from(text).length < MIN_READING_TEXT_LENGTH) {
    return { error: `text must contain at least ${MIN_READING_TEXT_LENGTH} characters` };
  }
  if (value.chapterLabel !== undefined && typeof value.chapterLabel !== "string") {
    return { error: "chapterLabel must be a string when provided" };
  }

  return {
    fingerprint: value.fingerprint,
    unitKind: value.unitKind,
    locator: value.locator.trim(),
    chapterLabel: value.chapterLabel?.trim() || undefined,
    text,
  };
}

function serializeUnit(unit: ReadingIngestUnitRow) {
  return {
    id: unit.id,
    fingerprint: unit.fingerprint,
    status: unit.status,
    firstSeenAt: unit.firstSeenAt,
    lastSeenAt: unit.lastSeenAt,
  };
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { bookId: string };
}) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const book = await getBookByIdForUser(params.bookId, session.userId);
  if (!book) return Response.json({ error: "Book not found" }, { status: 404 });

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = parseIngestPayload(rawBody);
  if ("error" in payload) return Response.json({ error: payload.error }, { status: 400 });

  const expectedFingerprint = computeReadingFingerprint({
    userId: session.userId,
    bookId: params.bookId,
    unitKind: payload.unitKind,
    locator: payload.locator,
    text: payload.text,
  });
  if (payload.fingerprint !== expectedFingerprint) {
    return Response.json({ error: "fingerprint does not match payload" }, { status: 400 });
  }

  const inserted = await insertReadingIngestUnit({
    userId: session.userId,
    bookId: params.bookId,
    ...payload,
  });
  if (inserted) {
    scheduleReadingIngestUnit(inserted);
    return Response.json({ deduplicated: false, unit: serializeUnit(inserted) }, { status: 202 });
  }

  const existing = await getReadingIngestUnitByFingerprint(
    session.userId,
    params.bookId,
    payload.fingerprint,
  );
  if (!existing) {
    return Response.json({ error: "Ingest unit conflict could not be resolved" }, { status: 409 });
  }
  if (existing.status === "pending" || existing.status === "error") {
    scheduleReadingIngestUnit(existing);
  }
  return Response.json({ deduplicated: true, unit: serializeUnit(existing) });
}
