import { waitUntil } from "@vercel/functions";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { createResumableStreamContext } from "resumable-stream";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getSessionByIdForUser, updateActiveStreamId } from "~/lib/database/chat/chat-session";

/**
 * GET /api/chat/resume/:sessionId
 *
 * Resumes an in-flight chat stream by session id. Used by the client after a
 * disconnect or reload to pick the server-side SSE back up where it left off.
 *
 * - 401 if unauthenticated.
 * - 404 if the session does not exist or belongs to another user.
 * - 204 if the session has no `active_stream_id` (nothing to resume), or if
 *   the recorded stream id turns out to be stale/finished — in which case the
 *   stale id is also cleared so future resumes short-circuit.
 * - Otherwise returns the resumed UI message stream with the standard headers.
 */
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

  if (session.activeStreamId == null) {
    // 204 No Content — the AI SDK's DefaultChatTransport with `resume: true`
    // ignores an empty 204 body and leaves `useChat` in its idle state, so no
    // extra stream wrapping is required here.
    return new Response(null, { status: 204 });
  }

  const streamContext = createResumableStreamContext({ waitUntil });

  // `resumeExistingStream` returns:
  // - a stream when the generation is still in flight,
  // - `null` when the stream exists but is fully done,
  // - `undefined` when no stream exists for this id (the function died
  //   mid-stream before `onFinish` could clear `active_stream_id`, or the
  //   Redis key expired).
  // The latter two mean the recorded id is stale: previously we passed the
  // nullish value straight into `new Response(...)`, leaving the client
  // hanging on an empty 200 SSE and the session permanently pointing at a
  // dead stream. Self-heal by clearing the id and returning 204.
  //
  // A *thrown* error is different: it is likely a transient Redis/network
  // failure, not proof the stream is gone. Surface it as a 503 so the client
  // can retry, and keep `active_stream_id` intact.
  let resumed: ReadableStream<string> | null | undefined;
  try {
    resumed = await streamContext.resumeExistingStream(session.activeStreamId);
  } catch (err) {
    console.error(
      `Failed to resume stream ${session.activeStreamId} for session ${params.sessionId}:`,
      err,
    );
    return Response.json({ error: "Failed to resume stream" }, { status: 503 });
  }

  if (resumed == null) {
    try {
      await updateActiveStreamId(userId, params.sessionId, null);
    } catch (err) {
      console.error(`Failed to clear stale active_stream_id for ${params.sessionId}:`, err);
    }
    return new Response(null, { status: 204 });
  }

  return new Response(resumed, { headers: UI_MESSAGE_STREAM_HEADERS });
}
