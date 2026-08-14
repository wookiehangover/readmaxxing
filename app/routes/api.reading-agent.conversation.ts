import { createFlueClient, FlueApiError } from "@flue/sdk";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import {
  getLiveReadingAgentLease,
  getReadingAgentSchemaHealth,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  emptyReadingAgentConversation,
  sanitizeConversationMessages,
  type ReadingAgentConversation,
} from "~/lib/reading-agent/conversation";
import { readingConversationId } from "~/lib/reading-agent/conversation-id.server";

function scopedConversation(
  userId: string,
  bookId: string,
  phase: ReadingAgentConversation["phase"],
  messages: ReadingAgentConversation["messages"] = [],
): ReadingAgentConversation {
  return {
    phase,
    conversationId: readingConversationId(userId, bookId),
    bookId,
    messages,
  };
}

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const session = await getSessionFromRequest(request);
  if (!session) return Response.json({ error: "auth_required" }, { status: 401 });

  const sidecarConfigured = Boolean(
    process.env.READING_AGENT_URL && process.env.READING_AGENT_SECRET,
  );
  if (!sidecarConfigured) {
    return Response.json(emptyReadingAgentConversation("absent"));
  }

  const schema = await getReadingAgentSchemaHealth();
  if (!schema.ok) return Response.json(emptyReadingAgentConversation("absent"));

  const lease = await getLiveReadingAgentLease(session.userId);
  if (!lease) return Response.json(emptyReadingAgentConversation("absent"));

  const agentUrl = process.env.READING_AGENT_URL!;
  const conversationId = readingConversationId(session.userId, lease.bookId);
  const client = createFlueClient({
    url: `${agentUrl.replace(/\/+$/, "")}/${conversationId}`,
    token: process.env.READING_AGENT_SECRET,
  });

  try {
    const snapshot = await client.history({ signal: request.signal });
    return Response.json(
      scopedConversation(
        session.userId,
        lease.bookId,
        "live",
        sanitizeConversationMessages(snapshot.messages),
      ),
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    if (error instanceof FlueApiError && error.status === 404) {
      return Response.json(scopedConversation(session.userId, lease.bookId, "connecting"));
    }
    return Response.json(scopedConversation(session.userId, lease.bookId, "error"));
  }
}
