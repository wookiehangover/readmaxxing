import { assertUnambiguousClock } from "./equal-clock";
import type { PoolClient } from "pg";
import { withCanonicalBookWrite } from "~/lib/database/book/canonical-book-write";
import { DEFAULT_UPDATED_AT_SKEW_MS } from "~/lib/database/clamp-timestamp";
import { upsertHighlight, softDeleteHighlight } from "~/lib/database/annotation/highlight";
import { upsertNotebook } from "~/lib/database/annotation/notebook";
import { upsertBookmark, softDeleteBookmark } from "~/lib/database/bookmark/bookmark";
import { upsertBook, softDeleteBook } from "~/lib/database/book/book";
import { upsertPosition } from "~/lib/database/book/reading-position";
import { upsertSession, softDeleteSession } from "~/lib/database/chat/chat-session";
import { upsertSettings } from "~/lib/database/settings/user-settings";
import type { ChangeEntry } from "~/lib/sync/types";

export async function processEntry(
  userId: string,
  entry: ChangeEntry,
  failedBooks?: ReadonlySet<string>,
  sharedClient?: PoolClient,
): Promise<{
  accepted: boolean;
  reason?: string;
  retryable?: boolean;
  canonicalId?: string;
  outcome?: "applied" | "covered" | "alias";
  targetEntityId?: string;
}> {
  if (entry.operation !== "put" && entry.operation !== "delete") {
    return { accepted: false, reason: "Unsupported operation", retryable: false };
  }
  if (entry.operation === "put" && (!entry.data || typeof entry.data !== "object")) {
    return { accepted: false, reason: "Invalid mutation data", retryable: false };
  }
  if (
    !Number.isFinite(entry.timestamp) ||
    entry.timestamp > Date.now() + DEFAULT_UPDATED_AT_SKEW_MS ||
    !Number.isFinite(new Date(entry.timestamp).getTime())
  ) {
    return { accepted: false, reason: "Invalid mutation timestamp", retryable: false };
  }
  const bookId =
    (entry.data as { bookId?: string } | null)?.bookId ??
    (entry.entity === "position" || entry.entity === "notebook" ? entry.entityId : undefined);
  if (
    ["position", "notebook", "highlight", "bookmark", "chat_session"].includes(entry.entity) &&
    bookId &&
    failedBooks?.has(bookId)
  ) {
    return {
      accepted: false,
      reason: "Parent book mutation failed; retry dependent mutation",
      retryable: true,
    };
  }
  return withCanonicalBookWrite(
    userId,
    entry,
    (normalized, client) => applyEntry(userId, normalized, client),
    sharedClient,
  );
}

async function applyEntry(userId: string, entry: ChangeEntry, client?: PoolClient) {
  if (client) await assertUnambiguousClock(client, userId, entry);
  // Keep replay ordering stable. DAL updated_at tracks server pull visibility;
  // the original outbox clock is stored separately and returned to mergers.
  let changed: unknown;
  const outcome = () => ({
    accepted: true,
    outcome: changed ? ("applied" as const) : ("covered" as const),
  });
  const mutationAt = new Date(entry.timestamp);
  const hasSnapshot = entry.data !== null && typeof entry.data === "object";
  const hasBookSnapshot =
    hasSnapshot && typeof (entry.data as { bookId?: unknown }).bookId === "string";
  switch (entry.entity) {
    case "book": {
      if (entry.operation === "put" || hasSnapshot) {
        const data = entry.data as {
          id: string;
          title?: string | null;
          author?: string | null;
          format?: string | null;
          fileHash?: string | null;
          remoteCoverUrl?: string | null;
          remoteFileUrl?: string | null;
          updatedAt?: number | null;
          deletedAt?: number | null;
        };

        const bookData = {
          id: entry.entityId,
          title: data.title,
          author: data.author,
          format: data.format,
          fileHash: data.fileHash,
          updatedAt: mutationAt,
          deletedAt:
            entry.operation === "delete"
              ? mutationAt
              : data.deletedAt != null
                ? new Date(data.deletedAt)
                : null,
          fileBlobUrl: data.remoteFileUrl,
          coverBlobUrl: data.remoteCoverUrl,
        };
        changed = await upsertBook(userId, bookData, client);
      } else {
        changed = await softDeleteBook(userId, entry.entityId, mutationAt, client);
      }
      return outcome();
    }

    case "position": {
      if (entry.operation === "put") {
        const data = entry.data as { bookId: string; cfi: string | null };
        changed = await upsertPosition(
          userId,
          data.bookId ?? entry.entityId,
          data.cfi ?? null,
          new Date(entry.timestamp),
          client,
        );
      }
      // delete is a no-op for positions
      return outcome();
    }

    case "highlight": {
      if (entry.operation === "put" || hasBookSnapshot) {
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
        changed = await upsertHighlight(
          userId,
          {
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
            createdAt: data.createdAt ? new Date(data.createdAt) : mutationAt,
            updatedAt: mutationAt,
            deletedAt:
              entry.operation === "delete"
                ? mutationAt
                : data.deletedAt != null
                  ? new Date(data.deletedAt)
                  : null,
          },
          client,
        );
      } else {
        changed = await softDeleteHighlight(userId, entry.entityId, mutationAt, client);
      }
      return outcome();
    }

    case "bookmark": {
      if (entry.operation === "put" || hasBookSnapshot) {
        const data = entry.data as {
          id: string;
          bookId: string;
          cfi?: string | null;
          label?: string | null;
          pageNumber?: number | null;
          displayPage?: number | null;
          createdAt?: number | null;
          updatedAt?: number | null;
          deletedAt?: number | null;
        };
        changed = await upsertBookmark(
          userId,
          {
            id: entry.entityId,
            bookId: data.bookId,
            cfi: data.cfi ?? null,
            label: data.label ?? null,
            pageNumber: data.pageNumber ?? null,
            displayPage: data.displayPage ?? null,
            createdAt: data.createdAt ? new Date(data.createdAt) : mutationAt,
            updatedAt: mutationAt,
            deletedAt:
              entry.operation === "delete"
                ? mutationAt
                : data.deletedAt != null
                  ? new Date(data.deletedAt)
                  : null,
          },
          client,
        );
      } else {
        changed = await softDeleteBookmark(userId, entry.entityId, mutationAt, client);
      }
      return outcome();
    }

    case "notebook": {
      if (entry.operation === "put") {
        const data = entry.data as {
          bookId: string;
          content: unknown;
          updatedAt?: number | null;
        };
        changed = await upsertNotebook(
          userId,
          data.bookId ?? entry.entityId,
          data.content,
          mutationAt,
          client,
        );
      }
      // delete is a no-op for notebooks
      return outcome();
    }

    case "chat_session": {
      if (entry.operation === "put" || hasBookSnapshot) {
        const data = entry.data as {
          id: string;
          bookId?: string | null;
          title?: string | null;
          createdAt?: number | null;
          updatedAt?: number | null;
          deletedAt?: number | null;
        };
        changed = await upsertSession(
          userId,
          {
            id: entry.entityId,
            bookId: data.bookId,
            title: data.title,
            createdAt: data.createdAt ? new Date(data.createdAt) : mutationAt,
            updatedAt: mutationAt,
            deletedAt:
              entry.operation === "delete"
                ? mutationAt
                : data.deletedAt != null
                  ? new Date(data.deletedAt)
                  : null,
          },
          client,
        );
      } else {
        changed = await softDeleteSession(userId, entry.entityId, mutationAt, client);
      }
      return outcome();
    }

    case "chat_message": {
      // Chat messages are server-authoritative: only /api/chat writes them
      // (see AGENTS.md "Chat architecture"). Wave 1 audit flagged that this
      // branch still accepted an unclamped client `createdAt`, leaving a
      // latent vector for clock-skewed clients to poison message ordering.
      // After Task B, the client no longer pushes chat_message entries; this
      // endpoint now rejects any that slip through rather than trusting them.
      return {
        accepted: false,
        reason: "chat_message entries are not accepted via /api/sync/push",
        retryable: false,
      };
    }

    case "settings": {
      if (entry.operation === "put") {
        changed = await upsertSettings(userId, entry.data, new Date(entry.timestamp), client);
      }
      // delete is a no-op for settings
      return outcome();
    }

    default: {
      console.warn(`[sync/push] Skipping unsupported entity type: ${entry.entity}`);
      return {
        accepted: false,
        reason: `Unsupported entity type: ${entry.entity}`,
        retryable: false,
      };
    }
  }
}
