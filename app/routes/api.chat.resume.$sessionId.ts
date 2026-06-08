import { requireAuth } from "~/lib/database/auth-middleware";
import { getSessionByIdForUser } from "~/lib/database/chat/chat-session";
import { getEnv, isDatabaseRuntimeAvailable } from "~/lib/env.server";

/**
 * GET /api/chat/resume/:sessionId
 *
 * Resumes an in-flight chat stream by session id. Used by the client after a
 * disconnect or reload to pick the Agent-owned SSE back up where it left off.
 *
 * - 401 if unauthenticated.
 * - 404 if the session does not exist or belongs to another user.
 * - 204 if the session has no `active_stream_id` (nothing to resume).
 * - Otherwise returns the resumed UI message stream with the standard headers.
 */
export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { sessionId: string };
}) {
  if (!isDatabaseRuntimeAvailable()) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const session = await getSessionByIdForUser(params.sessionId, userId);
  if (!session) {
    return new Response("Not found", { status: 404 });
  }

  if (session.activeStreamId == null) {
    // 204 No Content — the AI SDK's DefaultChatTransport with `resume: true`
    // ignores an empty 204 body and leaves `useChat` in its idle state, so no
    // extra stream wrapping is required here.
    return new Response(null, { status: 204 });
  }

  const agents = getEnv().AGENTS;
  if (!agents) {
    return Response.json({ error: "Chat Agent binding not configured" }, { status: 503 });
  }

  const agent = agents.get(agents.idFromName(params.sessionId));
  const resumeUrl = new URL("/resume", request.url);
  resumeUrl.searchParams.set("streamId", session.activeStreamId);

  return agent.fetch(new Request(resumeUrl, { method: "GET" }));
}
