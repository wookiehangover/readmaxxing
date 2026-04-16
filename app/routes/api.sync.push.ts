import { requireAuth } from "~/lib/database/auth-middleware";
import { upsertHighlight, softDeleteHighlight } from "~/lib/database/annotation/highlight";
import { upsertNotebook } from "~/lib/database/annotation/notebook";
import { upsertBook, softDeleteBook } from "~/lib/database/book/book";
import { upsertPosition } from "~/lib/database/book/reading-position";
import { upsertSession, softDeleteSession, upsertMessage } from "~/lib/database/chat/chat-session";
import { upsertSettings } from "~/lib/database/settings/user-settings";
import { upsertUser } from "~/lib/database/user/user";
import type { SyncPushRequest, SyncPushResponse, ChangeEntry } from "~/lib/sync/types";

async function processEntry(
  userId: string,
  entry: ChangeEntry,
): Promise<{ accepted: boolean; reason?: string }> {
  switch (entry.entity) {
    case "book": {
      if (entry.operation === "put") {
        const data = entry.data as {
          id: string;
          title?: string | null;
          author?: string | null;
          format?: string | null;
          fileHash?: string | null;
        };
        await upsertBook(userId, {
          id: entry.entityId,
          title: data.title,
          author: data.author,
          format: data.format,
          fileHash: data.fileHash,
        });
      } else {
        await softDeleteBook(userId, entry.entityId);
      }
      return { accepted: true };
    }

    case "position": {
      if (entry.operation === "put") {
        const data = entry.data as { bookId: string; cfi: string | null };
        await upsertPosition(
          userId,
          data.bookId ?? entry.entityId,
          data.cfi ?? null,
          new Date(entry.timestamp),
        );
      }
      // delete is a no-op for positions
      return { accepted: true };
    }

    case "highlight": {
      if (entry.operation === "put") {
        const data = entry.data as {
          id: string;
          bookId: string;
          cfiRange?: string | null;
          text?: string | null;
          color?: string | null;
          pageNumber?: number | null;
          textOffset?: number | null;
          textLength?: number | null;
          createdAt?: number | null;
          deletedAt?: number | null;
        };
        await upsertHighlight(userId, {
          id: entry.entityId,
          bookId: data.bookId,
          cfiRange: data.cfiRange,
          text: data.text,
          color: data.color,
          pageNumber: data.pageNumber,
          textOffset: data.textOffset,
          textLength: data.textLength,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(entry.timestamp),
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        });
      } else {
        await softDeleteHighlight(userId, entry.entityId);
      }
      return { accepted: true };
    }

    case "notebook": {
      if (entry.operation === "put") {
        const data = entry.data as {
          bookId: string;
          content: unknown;
          updatedAt?: number | null;
        };
        await upsertNotebook(
          userId,
          data.bookId ?? entry.entityId,
          data.content,
          data.updatedAt ? new Date(data.updatedAt) : new Date(entry.timestamp),
        );
      }
      // delete is a no-op for notebooks
      return { accepted: true };
    }

    case "chat_session": {
      if (entry.operation === "put") {
        const data = entry.data as {
          id: string;
          bookId?: string | null;
          title?: string | null;
          createdAt?: number | null;
          updatedAt?: number | null;
          deletedAt?: number | null;
        };
        await upsertSession(userId, {
          id: entry.entityId,
          bookId: data.bookId,
          title: data.title,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(entry.timestamp),
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(entry.timestamp),
          deletedAt: data.deletedAt ? new Date(data.deletedAt) : null,
        });
      } else {
        await softDeleteSession(userId, entry.entityId);
      }
      return { accepted: true };
    }

    case "chat_message": {
      if (entry.operation === "put") {
        const data = entry.data as {
          id: string;
          sessionId: string;
          role: string;
          content?: string | null;
          parts?: unknown | null;
          createdAt?: number | null;
        };
        await upsertMessage({
          id: entry.entityId,
          sessionId: data.sessionId,
          role: data.role,
          content: data.content,
          parts: data.parts,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(entry.timestamp),
        });
      }
      // delete is a no-op for append-only messages
      return { accepted: true };
    }

    case "settings": {
      if (entry.operation === "put") {
        await upsertSettings(userId, entry.data, new Date(entry.timestamp));
      }
      // delete is a no-op for settings
      return { accepted: true };
    }

    default: {
      console.warn(`[sync/push] Skipping unsupported entity type: ${entry.entity}`);
      return { accepted: false, reason: `Unsupported entity type: ${entry.entity}` };
    }
  }
}

export async function action({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { userId } = await requireAuth(request);

  let body: SyncPushRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.changes || !Array.isArray(body.changes)) {
    return Response.json({ error: "Missing or invalid 'changes' array" }, { status: 400 });
  }

  // Sort changes so parent entities (book) are processed before dependents (position).
  // This prevents FK violations when a position references a book in the same push batch.
  const entityOrder: Record<string, number> = {
    book: 0,
    position: 1,
    highlight: 2,
    notebook: 3,
    chat_session: 4,
    chat_message: 5,
    settings: 6,
  };
  const sortedChanges = [...body.changes].sort(
    (a, b) => (entityOrder[a.entity] ?? 99) - (entityOrder[b.entity] ?? 99),
  );

  const accepted: string[] = [];
  const rejected: SyncPushResponse["rejected"] = [];

  for (const entry of sortedChanges) {
    try {
      const result = await processEntry(userId, entry);
      if (result.accepted) {
        accepted.push(entry.id);
      } else {
        rejected.push({ id: entry.id, reason: result.reason ?? "Unknown error" });
      }
    } catch (err) {
      console.error(`[sync/push] Error processing entry ${entry.id}:`, err);
      rejected.push({
        id: entry.id,
        reason: err instanceof Error ? err.message : "Internal error",
      });
    }
  }

  // Update user's last_sync_at
  if (accepted.length > 0) {
    await upsertUser(userId);
  }

  const response: SyncPushResponse = {
    accepted,
    rejected,
    serverTimestamp: new Date().toISOString(),
  };

  return Response.json(response);
}
