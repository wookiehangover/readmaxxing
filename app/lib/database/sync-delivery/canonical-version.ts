import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { remapBookmarkId } from "~/lib/sync/remap-references";
import { canonicalJSON } from "./identity";
import type { ReceiptRow } from "./intake";
import { inspectOwnership } from "./ownership";
import { canonicalData } from "./canonical-data";
import type { CanonicalRecoverySnapshot } from "~/lib/sync/delivery-types";
const tables: Record<string, string> = {
  book: "book",
  notebook: "notebook",
  position: "reading_position",
  highlight: "highlight",
  bookmark: "bookmark",
  chat_session: "chat_session",
  settings: "user_settings",
  chat_message: "chat_message",
};
export class CanonicalOwnershipConflict extends Error {}
/** Read-only version and target identity used by both receipt decisions and user preconditions. */
export async function canonicalSnapshot(
  client: PoolClient,
  row: Pick<ReceiptRow, "originalSnapshot" | "targetEntityId" | "accountId">,
  lock = true,
): Promise<CanonicalRecoverySnapshot & { entityId: string; exists: boolean }> {
  const source = row.originalSnapshot,
    entity = String(source.entity),
    table = tables[entity];
  let id = row.targetEntityId ?? String(source.entityId);
  const ownership = await inspectOwnership(client, row.accountId, { ...source, entityId: id });
  if (!ownership.owned) throw new CanonicalOwnershipConflict("Canonical ownership unavailable");
  if (!table)
    return {
      version: "unsupported",
      entity,
      entityId: id,
      exists: false,
      status: "unsupported",
      data: null,
    };
  if (ownership.malformedAlias)
    return {
      version: createHash("sha256")
        .update(canonicalJSON({ id, references: ownership.references }))
        .digest("hex"),
      entity,
      entityId: id,
      exists: false,
      status: "unavailable",
      data: null,
    };
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
          sql`SELECT canonical_id AS "canonicalId" FROM readmax.book WHERE id=${currentId} AND user_id=${row.accountId} ${lock ? sql`FOR SHARE` : sql``}`,
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
  const record: Record<string, unknown> | null =
    (
      await client.query(sql`SELECT to_jsonb(t) AS value FROM ${sql.raw(`readmax.${table}`)} t
    WHERE ${entity === "chat_message" ? sql`EXISTS(SELECT 1 FROM readmax.chat_session s WHERE s.id=t.session_id AND s.user_id=${row.accountId})` : sql`t.user_id=${row.accountId}`}
      AND t.${sql.raw(key)}=${entity === "settings" ? row.accountId : id} ${lock ? sql`FOR SHARE OF t` : sql``}`)
    ).rows[0]?.value ?? null;
  return {
    version: createHash("sha256").update(canonicalJSON({ id, record })).digest("hex"),
    entityId: id,
    exists: record !== null,
    entity,
    status: record === null ? "missing" : record.deleted_at != null ? "deleted" : "present",
    data: record === null ? null : canonicalData(entity, record),
  };
}
