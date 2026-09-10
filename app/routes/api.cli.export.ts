import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { getNotebookMarkdownForUser } from "~/lib/database/annotation/notebook";
import { getCurrentReadingArtifacts } from "~/lib/database/reading-artifact/reading-artifact";
import {
  getSessionByIdForUser,
  getSessionsByUserAndBook,
  getMessagesBySession,
} from "~/lib/database/chat/chat-session";
import { chatToMarkdown } from "~/lib/export/chat-markdown";

export async function loader({ request }: { request: Request }) {
  const { userId } = await requireAuth(request);
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const bookId = params.get("bookId");
  const sessionId = params.get("sessionId");
  if (!["notes", "outline", "chat"].includes(kind ?? "")) {
    return Response.json({ error: "kind must be notes, outline, or chat" }, { status: 400 });
  }
  if ((!bookId && !sessionId) || (sessionId && (kind !== "chat" || bookId))) {
    return Response.json(
      { error: "Provide bookId, or sessionId for a single chat" },
      { status: 400 },
    );
  }
  if (bookId) {
    const book = await getBookByIdForUser(bookId, userId);
    if (!book || book.deletedAt) return Response.json({ error: "Book not found" }, { status: 404 });
  }
  let markdown: string;
  if (kind === "notes") {
    markdown = await getNotebookMarkdownForUser(userId, bookId!);
  } else if (kind === "outline") {
    const artifacts = await getCurrentReadingArtifacts(userId, bookId!);
    markdown = artifacts.find((artifact) => artifact.kind === "outline")?.content ?? "";
  } else {
    const sessions = sessionId
      ? [await getSessionByIdForUser(sessionId, userId)].filter((session) => session !== null)
      : await getSessionsByUserAndBook(userId, bookId!);
    if (sessionId && sessions.length === 0)
      return Response.json({ error: "Chat not found" }, { status: 404 });
    const conversations: string[] = [];
    for (const session of sessions.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      conversations.push(chatToMarkdown(session, await getMessagesBySession(session.id)));
    }
    markdown = conversations.join("\n\n---\n\n");
  }
  return new Response(markdown ? `${markdown.trimEnd()}\n` : "", {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
  });
}
