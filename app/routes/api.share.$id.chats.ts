import { getMessagesBySessions, getSessionsByUserAndBook } from "~/lib/database/chat/chat-session";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";

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
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const validation = await validateSharedChatsLink(params.id);
  if (validation.response) return validation.response;
  const shareLink = validation.shareLink;
  if (!shareLink) return Response.json({ error: "Share link not found" }, { status: 404 });

  const sessions = await getSessionsByUserAndBook(shareLink.userId, shareLink.bookId);
  const messages = await getMessagesBySessions(sessions.map((session) => session.id));
  const messagesBySession = new Map<string, typeof messages>();

  for (const message of messages) {
    const existing = messagesBySession.get(message.sessionId) ?? [];
    existing.push(message);
    messagesBySession.set(message.sessionId, existing);
  }

  const sessionsWithMessages = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    messages: (messagesBySession.get(session.id) ?? []).map((message) => ({
      role: message.role,
      content: message.content ?? "",
      createdAt: message.createdAt.toISOString(),
    })),
  }));

  return Response.json({ sessions: sessionsWithMessages });
}
