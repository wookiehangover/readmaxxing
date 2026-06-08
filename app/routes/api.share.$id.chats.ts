import { getMessagesBySession, getSessionsByUser } from "~/lib/database/chat/chat-session";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";
import { isDatabaseRuntimeAvailable } from "~/lib/env.server";

interface ValidationResult {
  shareLink?: ShareLinkRow;
  response?: Response;
}

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

function isExhausted(shareLink: ShareLinkRow): boolean {
  return shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses;
}

async function validateSharedChatsLink(id: string): Promise<ValidationResult> {
  const shareLink = await getShareLink(id);
  if (!shareLink)
    return { response: Response.json({ error: "Share link not found" }, { status: 404 }) };
  if (isExpired(shareLink)) {
    return { response: Response.json({ error: "Share link expired" }, { status: 410 }) };
  }
  if (isExhausted(shareLink)) {
    return { response: Response.json({ error: "Share link exhausted" }, { status: 410 }) };
  }
  if (!shareLink.shareChats) {
    return { response: Response.json({ error: "Shared chats are disabled" }, { status: 403 }) };
  }
  return { shareLink };
}

export async function loader({ params }: { params: { id: string } }) {
  if (!isDatabaseRuntimeAvailable()) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const validation = await validateSharedChatsLink(params.id);
  if (validation.response) return validation.response;
  const shareLink = validation.shareLink;
  if (!shareLink) return Response.json({ error: "Share link not found" }, { status: 404 });

  const sessions = (await getSessionsByUser(shareLink.userId)).filter(
    (session) => session.bookId === shareLink.bookId,
  );
  const sessionsWithMessages = await Promise.all(
    sessions.map(async (session) => ({
      id: session.id,
      title: session.title,
      messages: (await getMessagesBySession(session.id)).map((message) => ({
        role: message.role,
        content: message.content ?? "",
        createdAt: message.createdAt.toISOString(),
      })),
    })),
  );

  return Response.json({ sessions: sessionsWithMessages });
}
