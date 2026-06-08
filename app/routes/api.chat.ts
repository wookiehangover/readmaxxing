import type { UIMessage } from "ai";
import type { Route } from "./+types/api.chat";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getSessionByIdForUser } from "~/lib/database/chat/chat-session";
import { getEnv, isDatabaseRuntimeAvailable } from "~/lib/env.server";

interface PerBookContext {
  visibleText?: string;
  currentChapterIndex?: number;
}

interface ChatRequestBody {
  sessionId?: string;
  bookId?: string;
  /** Multi-book contract (additive): all selected books, primary first. */
  bookIds?: string[];
  message?: UIMessage;
  visibleText?: string;
  currentChapterIndex?: number;
  /** Optional per-book visible-text/current-chapter context, keyed by bookId. */
  bookContexts?: Record<string, PerBookContext>;
}

function getAgentStub(sessionId: string) {
  const agents = getEnv().AGENTS;
  if (!agents) return null;
  return agents.get(agents.idFromName(sessionId));
}

export async function action({ request }: Route.ActionArgs) {
  if (!isDatabaseRuntimeAvailable()) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const authSession = await getSessionFromRequest(request);
  if (!authSession) {
    return Response.json({ error: "auth_required" }, { status: 401 });
  }
  const { userId } = authSession;

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId, bookId, message } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }
  if (!bookId || typeof bookId !== "string") {
    return Response.json({ error: "bookId is required" }, { status: 400 });
  }
  if (!message || typeof message !== "object" || !message.id || message.role !== "user") {
    return Response.json({ error: "message with role='user' is required" }, { status: 400 });
  }

  const session = await getSessionByIdForUser(sessionId, userId);
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const agent = getAgentStub(sessionId);
  if (!agent) {
    return Response.json({ error: "Chat Agent binding not configured" }, { status: 503 });
  }

  return agent.fetch(
    new Request(new URL("/chat", request.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, userId }),
    }),
  );
}
