import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  getCurrentReadingArtifacts,
  persistReadingArtifactRevision,
  type ReadingArtifactKind,
  type ReadingArtifactRow,
} from "~/lib/database/reading-artifact/reading-artifact";

const ARTIFACT_KINDS: ReadingArtifactKind[] = ["outline", "characters", "wiki"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOutlineSavePayload(value: unknown): { content: string } | { error: string } {
  if (!isRecord(value)) return { error: "body must be an object" };
  if (typeof value.content !== "string") return { error: "content must be a string" };
  return { content: value.content };
}

function serializeArtifact(artifact: ReadingArtifactRow) {
  return {
    content: artifact.content,
    revisionId: artifact.revisionId,
    updatedAt: artifact.updatedAt,
  };
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { bookId: string };
}) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const book = await getBookByIdForUser(params.bookId, session.userId);
  if (!book) return Response.json({ error: "Book not found" }, { status: 404 });

  const rows = await getCurrentReadingArtifacts(session.userId, params.bookId);
  const artifacts = Object.fromEntries(
    ARTIFACT_KINDS.map((kind) => {
      const row = rows.find((artifact) => artifact.kind === kind);
      return [kind, row ? serializeArtifact(row) : null];
    }),
  );

  return Response.json({ bookId: params.bookId, artifacts });
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: { bookId: string };
}) {
  if (request.method !== "PUT" && request.method !== "PATCH") {
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
  const payload = parseOutlineSavePayload(rawBody);
  if ("error" in payload) return Response.json({ error: payload.error }, { status: 400 });

  const artifact = await persistReadingArtifactRevision({
    userId: session.userId,
    bookId: params.bookId,
    kind: "outline",
    content: payload.content,
    actor: "user",
    sourceUnitId: null,
    sourceFingerprint: null,
    summary: "User edited outline",
  });
  return Response.json({ bookId: params.bookId, artifact: serializeArtifact(artifact) });
}
