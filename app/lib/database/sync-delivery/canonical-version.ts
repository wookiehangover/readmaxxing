import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { remapBookmarkId } from "~/lib/sync/remap-references";
import { canonicalJSON } from "./identity";
import type { ReceiptRow } from "./intake";
const tables: Record<string, string> = {
  book: "book",
  notebook: "notebook",
  position: "reading_position",
  highlight: "highlight",
  bookmark: "bookmark",
  chat_session: "chat_session",
  settings: "user_settings",
};
/** Read-only version and target identity used by both receipt decisions and user preconditions. */
export async function canonicalSnapshot(client: PoolClient, row: ReceiptRow) {
  const source = row.originalSnapshot,
    entity = String(source.entity),
    table = tables[entity];
  let id = row.targetEntityId ?? String(source.entityId);
  if (!table) return { version: "unsupported", entityId: id, exists: false };
  let bookId = ["book", "notebook", "position"].includes(entity) ? id : undefined;
  if (entity === "bookmark") {
    const data = source.data as { bookId?: unknown } | null;
    if (typeof data?.bookId === "string") bookId = data.bookId;
    const embedded = (
      await client.query<{
        id: string;
      }>(sql`SELECT id FROM readmax.book WHERE user_id=${row.accountId}
      AND left(${id},length('bookmark:' || id || ':'))='bookmark:' || id || ':' ORDER BY length(id) DESC LIMIT 1`)
    ).rows[0];
    bookId = embedded?.id ?? bookId;
  }
  if (bookId) {
    const fromId = bookId,
      seen = new Set<string>();
    let currentId: string = bookId;
    while (!seen.has(currentId)) {
      seen.add(currentId);
      const book: { canonicalId: string | null } | undefined = (
        await client.query<{ canonicalId: string | null }>(
          sql`SELECT canonical_id AS "canonicalId" FROM readmax.book WHERE id=${currentId} AND user_id=${row.accountId}`,
        )
      ).rows[0];
      if (!book?.canonicalId) break;
      currentId = book.canonicalId;
    }
    id = entity === "bookmark" ? remapBookmarkId(id, { fromId, toId: currentId }) : currentId;
  }
  const key =
    entity === "settings"
      ? "user_id"
      : ["notebook", "position"].includes(entity)
        ? "book_id"
        : "id";
  const record =
    (
      await client.query(sql`SELECT to_jsonb(t) AS value FROM ${sql.raw(`readmax.${table}`)} t
    WHERE user_id=${row.accountId} AND ${sql.raw(key)}=${entity === "settings" ? row.accountId : id}`)
    ).rows[0]?.value ?? null;
  return {
    version: createHash("sha256").update(canonicalJSON({ id, record })).digest("hex"),
    entityId: id,
    exists: record !== null,
  };
}
