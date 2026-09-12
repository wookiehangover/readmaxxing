import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import type { ChangeEntry } from "~/lib/sync/types";
import { canonicalJSON } from "./identity";
/** Guard LWW handlers whose historical null return conflated equality and conflict. */
export async function assertUnambiguousClock(
  client: PoolClient,
  account: string,
  entry: ChangeEntry,
) {
  const tables: Record<string, string> = {
    book: "book",
    notebook: "notebook",
    settings: "user_settings",
    bookmark: "bookmark",
  };
  const table = tables[entry.entity];
  if (!table || entry.operation !== "put") return;
  const data = entry.data as Record<string, unknown>;
  if (data.deletedAt != null) return;
  const key =
    entry.entity === "settings" ? "user_id" : entry.entity === "notebook" ? "book_id" : "id";
  const row = (
    await client.query<{
      value: Record<string, unknown>;
    }>(sql`SELECT to_jsonb(t) AS value FROM ${sql.raw(`readmax.${table}`)} t
    WHERE user_id=${account} AND ${sql.raw(key)}=${entry.entity === "settings" ? account : entry.entityId}
      AND COALESCE(mutation_at,updated_at)=${new Date(entry.timestamp).toISOString()}::timestamptz`)
  ).rows[0]?.value;
  if (!row || row.deleted_at != null) return;
  let expected: Record<string, unknown>;
  if (entry.entity === "settings") expected = { settings: entry.data };
  else if (entry.entity === "notebook") expected = { content: data.content };
  else if (entry.entity === "book") {
    expected = {};
    for (const [field, column] of Object.entries({
      title: "title",
      author: "author",
      format: "format",
      fileHash: "file_hash",
      remoteFileUrl: "file_blob_url",
      remoteCoverUrl: "cover_blob_url",
    }))
      if (data[field] != null) expected[column] = data[field];
  } else
    expected = {
      book_id: data.bookId,
      cfi: data.cfi ?? null,
      label: data.label ?? null,
      page_number: data.pageNumber ?? null,
      display_page: data.displayPage ?? null,
    };
  if (
    Object.entries(expected).some(
      ([key, value]) => canonicalJSON(row[key]) !== canonicalJSON(value),
    )
  )
    throw new Error("Conflicting edits share a mutation timestamp");
}
