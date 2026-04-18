import { requireAuth } from "~/lib/database/auth-middleware";
import { upsertHighlight, softDeleteHighlight } from "~/lib/database/annotation/highlight";
import { upsertNotebook } from "~/lib/database/annotation/notebook";
import {
  upsertBook,
  softDeleteBook,
  findBookByUserAndHash,
  insertTombstonedBook,
  getBookByIdForUser,
  updateBookBlobUrls,
} from "~/lib/database/book/book";
import { upsertPosition } from "~/lib/database/book/reading-position";
import { upsertSession, softDeleteSession, upsertMessage } from "~/lib/database/chat/chat-session";
import { upsertSettings } from "~/lib/database/settings/user-settings";
import { upsertUser } from "~/lib/database/user/user";
import type { SyncPushRequest, SyncPushResponse, ChangeEntry } from "~/lib/sync/types";

export async function processEntry(
  userId: string,
  entry: ChangeEntry,
): Promise<{ accepted: boolean; reason?: string; canonicalId?: string }> {
  switch (entry.entity) {
    case "book": {
      if (entry.operation === "put") {
        const data = entry.data as {
          id: string;
          title?: string | null;
          author?: string | null;
          format?: string | null;
          fileHash?: string | null;
          remoteCoverUrl?: string | null;
          remoteFileUrl?: string | null;
          updatedAt?: number | null;
        };

        // Cross-device dedup: if another non-deleted book for this user
        // already has the same file_hash, converge to that canonical id.
        if (data.fileHash) {
          const canonical = await findBookByUserAndHash(userId, data.fileHash);
          if (canonical && canonical.id !== entry.entityId) {
            // Only tombstone the incoming id if it is not already the
            // canonical (or already tombstoned) — keeps the operation
            // idempotent across retries.
            const existing = await getBookByIdForUser(entry.entityId, userId);
            if (!existing || existing.deletedAt == null) {
              await insertTombstonedBook(userId, {
                id: entry.entityId,
                fileHash: data.fileHash,
                createdAt: data.updatedAt ? new Date(data.updatedAt) : new Date(entry.timestamp),
              });
            }
            return { accepted: true, canonicalId: canonical.id };
          }
        }

        await upsertBook(userId, {
          id: entry.entityId,
          title: data.title,
          author: data.author,
          format: data.format,
          fileHash: data.fileHash,
          updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(entry.timestamp),
        });

        // Persist blob URLs if the client carried them. Additive to the
        // onUploadCompleted webhook in api.sync.files.upload.ts (the webhook
        // is still a fast path but no longer the only way a URL reaches the
        // DB). COALESCE inside updateBookBlobUrls prevents a nullish value
        // on one side from clobbering an existing non-null column.
        if (data.remoteCoverUrl || data.remoteFileUrl) {
          await updateBookBlobUrls(entry.entityId, {
            coverBlobUrl: data.remoteCoverUrl ?? undefined,
            fileBlobUrl: data.remoteFileUrl ?? undefined,
          });
        }
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
          textAnchor?: {
            chapterIndex: number;
            snippet: string;
            offset?: number;
          } | null;
          note?: string | null;
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
          textAnchor: data.textAnchor ?? null,
          note: data.note ?? null,
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

  const accepted: SyncPushResponse["accepted"] = [];
  const rejected: SyncPushResponse["rejected"] = [];

  for (const entry of sortedChanges) {
    try {
      const result = await processEntry(userId, entry);
      if (result.accepted) {
        accepted.push(
          result.canonicalId ? { id: entry.id, canonicalId: result.canonicalId } : { id: entry.id },
        );
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
