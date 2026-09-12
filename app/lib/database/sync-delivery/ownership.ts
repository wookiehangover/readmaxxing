import type { PoolClient } from "pg";
import { sql } from "pg-sql";

const GLOBAL = new Set(["book", "highlight", "bookmark", "chat_session", "chat_message"]);
export interface Ownership {
  owned: boolean;
  malformedAlias: boolean;
  references: Record<string, string>;
  resources: Array<{ namespace: string; id: string }>;
}
/** Read-only admission. Never reconcile or compress aliases while taking custody. */
export async function inspectOwnership(
  client: PoolClient,
  account: string,
  entry: Record<string, unknown>,
): Promise<Ownership> {
  const data =
    entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : {};
  const result: Ownership = { owned: true, malformedAlias: false, references: {}, resources: [] };
  for (const owner of [entry.ownerId, entry.userId, data.ownerId, data.userId]) {
    if (owner != null && owner !== account) result.owned = false;
  }
  const pending: Array<{ namespace: string; id: string }> = [];
  const add = (namespace: string, id: unknown, reference: string) => {
    if (typeof id !== "string" || !id) return;
    result.references[reference] = id;
    pending.push({ namespace, id });
  };
  const objects: unknown[] = [data];
  while (objects.length) {
    const current = objects.pop();
    if (!current || typeof current !== "object") continue;
    const fields = current as Record<string, unknown>;
    for (const owner of [fields.ownerId, fields.userId])
      if (owner != null && owner !== account) result.owned = false;
    add("book", fields.bookId, "referencedBookId");
    add("chat_session", fields.sessionId, "referencedSessionId");
    for (const value of Object.values(fields))
      if (value && typeof value === "object") objects.push(value);
  }
  const entity = String(entry.entity);
  if (GLOBAL.has(entity)) {
    add(entity, entry.entityId, "entityId");
    add(entity, data.id, "dataId");
  } else if (["notebook", "position"].includes(entity)) add("book", entry.entityId, "entityId");
  else if (entity !== "settings") add(`opaque:${entity}`, entry.entityId, "entityId");
  add("book", data.bookId, "bookId");
  add("book", entry.bookId, "envelopeBookId");
  add("chat_session", data.sessionId, "sessionId");
  add("chat_session", entry.sessionId, "envelopeSessionId");
  if (
    entity === "bookmark" &&
    typeof entry.entityId === "string" &&
    entry.entityId.startsWith("bookmark:")
  ) {
    const matches = await client.query<{ id: string }>(sql`SELECT id FROM readmax.book
      WHERE left(${entry.entityId},length('bookmark:' || id || ':'))='bookmark:' || id || ':' ORDER BY length(id) DESC`);
    for (const match of matches.rows) add("book", match.id, `embedded:${match.id}`);
    if (!matches.rows.length) add("book", entry.entityId.slice(9).split(":")[0], "embeddedBookId");
  }
  const visited = new Set<string>();
  for (let index = 0; index < pending.length; index++) {
    const resource = pending[index];
    const key = `${resource.namespace}\0${resource.id}`;
    if (visited.has(key)) continue;
    visited.add(key);
    result.resources.push(resource);
    const binding = await client.query<{
      account: string;
    }>(sql`SELECT account_id AS account FROM readmax.sync_resource_binding
      WHERE namespace=${resource.namespace} AND resource_id=${resource.id}`);
    if (binding.rows.some((row) => row.account !== account)) result.owned = false;
    if (!GLOBAL.has(resource.namespace)) continue;
    if (resource.namespace === "chat_message") {
      const row = await client.query<{
        account: string;
        session: string;
      }>(sql`SELECT s.user_id AS account,m.session_id AS session
        FROM readmax.chat_message m JOIN readmax.chat_session s ON s.id=m.session_id WHERE m.id=${resource.id}`);
      for (const item of row.rows) {
        if (item.account !== account) result.owned = false;
        add("chat_session", item.session, "existingSessionId");
      }
    } else {
      const table = sql.raw(`readmax.${resource.namespace}`);
      const rows = await client.query<{
        account: string;
        parent: string | null;
        alias: string | null;
      }>(sql`
        SELECT user_id AS account, ${resource.namespace === "book" ? sql`NULL::text` : sql`book_id`} AS parent,
          ${resource.namespace === "book" ? sql`canonical_id` : sql`NULL::text`} AS alias FROM ${table} WHERE id=${resource.id}`);
      for (const row of rows.rows) {
        if (row.account !== account) result.owned = false;
        add("book", row.parent, `parent:${resource.namespace}:${resource.id}`);
        if (row.alias) {
          add("book", row.alias, `alias:${resource.id}`);
          // A second read-only walk detects cycles/missing targets; continue the
          // ownership traversal through every reachable member even if malformed.
          const chain = new Set<string>([resource.id]);
          let next: string | null = row.alias;
          while (next) {
            if (chain.has(next)) {
              result.malformedAlias = true;
              break;
            }
            chain.add(next);
            const target: { rows: Array<{ owner: string; alias: string | null }> } =
              await client.query(
                sql`SELECT user_id AS owner,canonical_id AS alias FROM readmax.book WHERE id=${next}`,
              );
            if (!target.rows[0]) {
              result.malformedAlias = true;
              break;
            }
            if (target.rows[0].owner !== account) result.owned = false;
            next = target.rows[0].alias;
          }
          if (chain.size > 64) result.malformedAlias = true;
        }
      }
    }
  }
  return result;
}
export async function bindResources(client: PoolClient, account: string, ownership: Ownership) {
  for (const resource of ownership.resources.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.id.localeCompare(b.id),
  )) {
    const result = await client.query<{
      account: string;
    }>(sql`INSERT INTO readmax.sync_resource_binding(namespace,resource_id,account_id)
      VALUES(${resource.namespace},${resource.id},${account}) ON CONFLICT(namespace,resource_id) DO UPDATE
      SET resource_id=EXCLUDED.resource_id RETURNING account_id AS account`);
    if (result.rows[0]?.account !== account) throw new Error("Ownership binding conflict");
  }
}
