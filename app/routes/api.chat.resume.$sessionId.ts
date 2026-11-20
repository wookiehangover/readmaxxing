import { waitUntil } from "@vercel/functions";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { createResumableStreamContext } from "resumable-stream";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getSessionByIdForUser, updateActiveStreamId } from "~/lib/database/chat/chat-session";

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
    return new Response(null, { status: 204 });
  }

  const streamContext = createResumableStreamContext({ waitUntil });

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
