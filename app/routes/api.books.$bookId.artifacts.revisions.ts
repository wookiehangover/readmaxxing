import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import {
  listReadingArtifactRevisions,
  type ReadingArtifactKind,
} from "~/lib/database/reading-artifact/reading-artifact";

function isArtifactKind(value: string | null): value is ReadingArtifactKind {
  return value === "outline" || value === "characters" || value === "wiki";
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

  const kind = new URL(request.url).searchParams.get("kind");
  if (!isArtifactKind(kind)) {
    return Response.json({ error: "kind must be outline, characters, or wiki" }, { status: 400 });
  }

  const revisions = await listReadingArtifactRevisions({
    userId: session.userId,
    bookId: params.bookId,
    kind,
  });
  return Response.json({ bookId: params.bookId, kind, revisions });
}
