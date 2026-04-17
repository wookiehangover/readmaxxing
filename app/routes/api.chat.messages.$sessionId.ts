import type { UIMessage } from "ai";
import { requireAuth } from "~/lib/database/auth-middleware";
import {
  getMessagesBySession,
  getSessionByIdForUser,
  type ChatMessageRow,
} from "~/lib/database/chat/chat-session";

/**
 * GET /api/chat/messages/:sessionId
 *
 * Returns the full message history and current active stream id for a chat
 * session. Used by the client on mount to hydrate `useChat` from Postgres
 * (the server-authoritative source) and to decide whether to resume an
 * in-flight stream.
 *
 * - 401 if unauthenticated.
 * - 404 if the session does not exist or belongs to another user.
 */
function rowToUIMessage(row: ChatMessageRow): UIMessage {
  const parts = row.parts as UIMessage["parts"] | null;
  if (parts && Array.isArray(parts) && parts.length > 0) {
    return {
      id: row.id,
      role: row.role as UIMessage["role"],
      parts,
    };
  }
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: [{ type: "text", text: row.content ?? "" }],
  };
}

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { sessionId: string };
}) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const session = await getSessionByIdForUser(params.sessionId, userId);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await getMessagesBySession(params.sessionId);
  return Response.json({
    messages: rows.map(rowToUIMessage),
    activeStreamId: session.activeStreamId,
  });
}
