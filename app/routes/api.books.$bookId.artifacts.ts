import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  getCurrentReadingArtifacts,
  type ReadingArtifactKind,
  type ReadingArtifactRow,
} from "~/lib/database/reading-artifact/reading-artifact";

const ARTIFACT_KINDS: ReadingArtifactKind[] = ["outline", "characters", "wiki"];

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
