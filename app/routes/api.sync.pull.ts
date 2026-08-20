import { requireAuth } from "~/lib/database/auth-middleware";
import { getHighlightsByUserSince } from "~/lib/database/annotation/highlight";
import { getNotebooksByUserSince } from "~/lib/database/annotation/notebook";
import { getBookmarksByUser } from "~/lib/database/bookmark/bookmark";
import { getBooksByUserSince } from "~/lib/database/book/book";
import { getPositionsByUserSince } from "~/lib/database/book/reading-position";
import { getSessionsByUserSince, getMessagesByUserSince } from "~/lib/database/chat/chat-session";
import { getSettingsSince } from "~/lib/database/settings/user-settings";
import { encodePullCursor, parseCursorsParam } from "~/lib/sync/sync-cursors";
import type { EntityType, SyncPullResponse } from "~/lib/sync/types";

const SUPPORTED_ENTITY_TYPES: EntityType[] = [
  "book",
  "position",
  "highlight",
  "bookmark",
  "notebook",
  "chat_session",
  "chat_message",
  "settings",
];

const DEFAULT_PULL_LIMIT = 250;
const MAX_PULL_LIMIT = 1000;

function parseLimit(value: string | null): number {
  if (!value) return DEFAULT_PULL_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_PULL_LIMIT;
  return Math.min(parsed, MAX_PULL_LIMIT);
}

function appendBatch<T extends { updatedAt?: Date; createdAt?: Date }>(
  changes: SyncPullResponse["changes"],
  entity: EntityType,
  rows: T[],
  limit: number,
  cursorField: "updatedAt" | "createdAt",
  idOf: (record: T) => string,
) {
  if (rows.length === 0) return;

  const hasMore = rows.length > limit;
  const records = hasMore ? rows.slice(0, limit) : rows;
  const lastRecord = records[records.length - 1];
  const cursor = lastRecord?.[cursorField];
  if (!cursor || !lastRecord) return;

  changes.push({
    entity,
    records,
    cursor: encodePullCursor(cursor, idOf(lastRecord)),
    hasMore,
  });
}

export async function loader({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  const url = new URL(request.url);
  const cursorsParam = url.searchParams.get("cursors");
  const entityTypeParam = url.searchParams.get("entityType");
  const limit = parseLimit(url.searchParams.get("limit"));
  const queryLimit = limit + 1;

  // Per-entity cursors: each entity has its own `since` so one entity's lag
  // does not force the others to re-scan. Entities missing from the payload
  // default to epoch (pull from the beginning), preserving fresh-device
  // behavior.
  const {
    cursorsByEntity,
    cursorIdsByEntity,
    error: cursorsError,
  } = parseCursorsParam(cursorsParam);
  if (cursorsError) {
    return Response.json({ error: cursorsError }, { status: 400 });
  }

  const requestedTypes: EntityType[] = entityTypeParam
    ? (entityTypeParam
        .split(",")
        .filter((t) => SUPPORTED_ENTITY_TYPES.includes(t as EntityType)) as EntityType[])
    : SUPPORTED_ENTITY_TYPES;

  const changes: SyncPullResponse["changes"] = [];

  for (const entityType of requestedTypes) {
    const since = cursorsByEntity[entityType];
    switch (entityType) {
      case "book": {
        const books = await getBooksByUserSince(userId, since, queryLimit, cursorIdsByEntity.book);
        appendBatch(changes, "book", books, limit, "updatedAt", (book) => book.id);
        break;
      }

      case "position": {
        const positions = await getPositionsByUserSince(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.position,
        );
        appendBatch(
          changes,
          "position",
          positions,
          limit,
          "updatedAt",
          (position) => position.bookId,
        );
        break;
      }

      case "highlight": {
        const highlights = await getHighlightsByUserSince(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.highlight,
        );
        appendBatch(
          changes,
          "highlight",
          highlights,
          limit,
          "updatedAt",
          (highlight) => highlight.id,
        );
        break;
      }

      case "bookmark": {
        const bookmarks = await getBookmarksByUser(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.bookmark,
        );
        appendBatch(changes, "bookmark", bookmarks, limit, "updatedAt", (bookmark) => bookmark.id);
        break;
      }

      case "notebook": {
        const notebooks = await getNotebooksByUserSince(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.notebook,
        );
        appendBatch(
          changes,
          "notebook",
          notebooks,
          limit,
          "updatedAt",
          (notebook) => notebook.bookId,
        );
        break;
      }

      case "chat_session": {
        const sessions = await getSessionsByUserSince(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.chat_session,
        );
        appendBatch(changes, "chat_session", sessions, limit, "updatedAt", (session) => session.id);
        break;
      }

      case "chat_message": {
        const messages = await getMessagesByUserSince(
          userId,
          since,
          queryLimit,
          cursorIdsByEntity.chat_message,
        );
        appendBatch(changes, "chat_message", messages, limit, "createdAt", (message) => message.id);
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
