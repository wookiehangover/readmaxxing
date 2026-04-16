import { requireAuth } from "~/lib/database/auth-middleware";
import { getHighlightsByUserSince } from "~/lib/database/annotation/highlight";
import { getNotebooksByUserSince } from "~/lib/database/annotation/notebook";
import { getBooksByUserSince } from "~/lib/database/book/book";
import { getPositionsByUserSince } from "~/lib/database/book/reading-position";
import { getSessionsByUserSince, getMessagesByUserSince } from "~/lib/database/chat/chat-session";
import { getSettingsSince } from "~/lib/database/settings/user-settings";
import type { EntityType, SyncPullResponse } from "~/lib/sync/types";

const SUPPORTED_ENTITY_TYPES: EntityType[] = [
  "book",
  "position",
  "highlight",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
];

export async function loader({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const url = new URL(request.url);
  const sinceParam = url.searchParams.get("since");
  const entityTypeParam = url.searchParams.get("entityType");

  const since = sinceParam ? new Date(sinceParam) : new Date(0);
  if (isNaN(since.getTime())) {
    return Response.json({ error: "Invalid 'since' parameter" }, { status: 400 });
  }

  const requestedTypes: EntityType[] = entityTypeParam
    ? (entityTypeParam
        .split(",")
        .filter((t) => SUPPORTED_ENTITY_TYPES.includes(t as EntityType)) as EntityType[])
    : SUPPORTED_ENTITY_TYPES;

  const changes: SyncPullResponse["changes"] = [];

  for (const entityType of requestedTypes) {
    switch (entityType) {
      case "book": {
        const books = await getBooksByUserSince(userId, since);
        if (books.length > 0) {
          const latestUpdatedAt = books[books.length - 1].updatedAt;
          changes.push({
            entity: "book",
            records: books,
            cursor: latestUpdatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "position": {
        const positions = await getPositionsByUserSince(userId, since);
        if (positions.length > 0) {
          const latestUpdatedAt = positions[positions.length - 1].updatedAt;
          changes.push({
            entity: "position",
            records: positions,
            cursor: latestUpdatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "highlight": {
        const highlights = await getHighlightsByUserSince(userId, since);
        if (highlights.length > 0) {
          const latestCreatedAt = highlights[highlights.length - 1].createdAt;
          changes.push({
            entity: "highlight",
            records: highlights,
            cursor: latestCreatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "notebook": {
        const notebooks = await getNotebooksByUserSince(userId, since);
        if (notebooks.length > 0) {
          const latestUpdatedAt = notebooks[notebooks.length - 1].updatedAt;
          changes.push({
            entity: "notebook",
            records: notebooks,
            cursor: latestUpdatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "chat_session": {
        const sessions = await getSessionsByUserSince(userId, since);
        if (sessions.length > 0) {
          const latestUpdatedAt = sessions[sessions.length - 1].updatedAt;
          changes.push({
            entity: "chat_session",
            records: sessions,
            cursor: latestUpdatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "chat_message": {
        const messages = await getMessagesByUserSince(userId, since);
        if (messages.length > 0) {
          const latestCreatedAt = messages[messages.length - 1].createdAt;
          changes.push({
            entity: "chat_message",
            records: messages,
            cursor: latestCreatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }

      case "settings": {
        const settingsRow = await getSettingsSince(userId, since);
        if (settingsRow) {
          changes.push({
            entity: "settings",
            records: [settingsRow],
            cursor: settingsRow.updatedAt.toISOString(),
            hasMore: false,
          });
        }
        break;
      }
    }
  }

  const response: SyncPullResponse = {
    changes,
    serverTimestamp: new Date().toISOString(),
  };

  return Response.json(response);
}
