import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { remapBookmarkId } from "~/lib/sync/remap-references";
import type { ChangeEntry } from "~/lib/sync/types";
import { getPool } from "../pool";
import { findBookByUserAndHash } from "./book";
import { reconcileBookDependents } from "./reconcile-book-dependents";

interface AliasBook {
  id: string;
  userId: string;
  canonicalId: string | null;
  deletedAt: Date | null;
  fileHash: string | null;
  mutationAt: Date;
}
interface WriteResult {
  accepted: boolean;
  reason?: string;
  retryable?: boolean;
  canonicalId?: string;
}

async function readBook(client: PoolClient, userId: string, id: string) {
  const result = await client.query<AliasBook>(sql`
    SELECT id, user_id AS "userId", canonical_id AS "canonicalId", deleted_at AS "deletedAt",
      file_hash AS "fileHash", COALESCE(mutation_at, updated_at) AS "mutationAt"
    FROM readmax.book WHERE id = ${id} FOR UPDATE
  `);
  const book = result.rows[0];
  if (book && book.userId !== userId) throw new Error("Book belongs to another user");
  return book;
}

export async function resolveCanonicalBook(
  client: PoolClient,
  userId: string,
  id: string,
): Promise<AliasBook | undefined> {
  const visited = new Set<string>();
  const aliases: AliasBook[] = [];
  let current = id;
  let book: AliasBook | undefined;
  while (true) {
    if (visited.has(current) || visited.size >= 64) throw new Error("Invalid canonical book chain");
    visited.add(current);
    book = await readBook(client, userId, current);
    if (!book) {
      // Legacy dependent writes may predate a book upload. An authoritative
      // alias, however, must never resolve to an absent or unowned target.
      if (aliases.length) throw new Error("Canonical book is missing");
      return undefined;
    }
    if (!book.canonicalId) break;
    aliases.push(book);
    current = book.canonicalId;
  }
  for (const alias of aliases) {
    await reconcileBookDependents(client, userId, alias.id, book.id);
    if (alias.canonicalId !== book.id) {
      await client.query(sql`
        UPDATE readmax.book SET canonical_id = ${book.id},
          mutation_at = COALESCE(mutation_at, updated_at),
          updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
        WHERE id = ${alias.id} AND user_id = ${userId}
      `);
    }
  }
  return book;
}

async function deduplicateBook(client: PoolClient, userId: string, entry: ChangeEntry) {
  const existing = await resolveCanonicalBook(client, userId, entry.entityId);
  if (existing && existing.id !== entry.entityId) return existing.id;
  const data = entry.data as { fileHash?: unknown; deletedAt?: unknown } | null;
  // A normal tombstone is never evidence of an alias. Nor should a deletion
  // snapshot delete a separate live same-hash book.
  if (entry.operation !== "put" || !data?.fileHash || data.deletedAt != null || existing?.deletedAt)
    return;
  if (typeof data.fileHash !== "string") throw new Error("Invalid book hash");
  if (
    existing &&
    existing.fileHash !== data.fileHash &&
    entry.timestamp <= existing.mutationAt.getTime()
  )
    return;
  const match = await findBookByUserAndHash(userId, data.fileHash, client);
  if (!match || match.id === entry.entityId) return;
  const canonical = await resolveCanonicalBook(client, userId, match.id);
  if (!canonical || canonical.deletedAt) throw new Error("Canonical book is unavailable");
  const timestamp = new Date(entry.timestamp).toISOString();
  const alias = await client.query(sql`
    INSERT INTO readmax.book (id, user_id, file_hash, canonical_id, created_at, updated_at, mutation_at, deleted_at)
    VALUES (${entry.entityId}, ${userId}, ${data.fileHash}, ${canonical.id}, ${timestamp}, clock_timestamp(), ${timestamp}, ${timestamp})
    ON CONFLICT (id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id,
      deleted_at = EXCLUDED.deleted_at,
      mutation_at = COALESCE(readmax.book.mutation_at, readmax.book.updated_at),
      updated_at = GREATEST(clock_timestamp(), readmax.book.updated_at + INTERVAL '1 microsecond')
    WHERE readmax.book.user_id = EXCLUDED.user_id
    RETURNING id
  `);
  if (!alias.rows.length) throw new Error("Cannot persist canonical book alias");
  await reconcileBookDependents(client, userId, entry.entityId, canonical.id);
  return canonical.id;
}

async function normalizeDependent(client: PoolClient, userId: string, entry: ChangeEntry) {
  const data = entry.data as Record<string, unknown> | null;
  let bookId = typeof data?.bookId === "string" ? data.bookId : undefined;
  if (entry.entity === "notebook" || entry.entity === "position") bookId ??= entry.entityId;
  // Snapshotless deletes still find relocated random-ID entities. Deterministic
  // bookmark deletes can resolve via the explicit alias even after relocation.
  if (!bookId && ["highlight", "bookmark", "chat_session"].includes(entry.entity)) {
    const table = sql.raw(`readmax.${entry.entity}`);
    const result = await client.query<{ bookId: string | null }>(sql`
      SELECT book_id AS "bookId" FROM ${table} WHERE id = ${entry.entityId} AND user_id = ${userId}
    `);
    bookId = result.rows[0]?.bookId ?? undefined;
  }
  let entityId = entry.entityId;
  if (entry.entity === "bookmark") {
    const aliases = await client.query<{ id: string }>(sql`
      SELECT id FROM readmax.book WHERE user_id = ${userId} AND canonical_id IS NOT NULL
        AND left(${entityId}, length('bookmark:' || id || ':')) = 'bookmark:' || id || ':'
      ORDER BY length(id) DESC LIMIT 1
    `);
    const fromId = aliases.rows[0]?.id;
    if (fromId) {
      const canonical = await resolveCanonicalBook(client, userId, fromId);
      entityId = remapBookmarkId(entityId, { fromId, toId: canonical!.id });
      bookId ??= canonical!.id;
      const embedded = await resolveCanonicalBook(client, userId, bookId);
      if ((embedded?.id ?? bookId) !== canonical!.id)
        throw new Error("Conflicting bookmark book references");
    }
  }
  if (!bookId) return entry;
  const canonical = await resolveCanonicalBook(client, userId, bookId);
  const canonicalId = canonical?.id ?? bookId;
  if (entry.entity === "notebook" || entry.entity === "position") {
    const keyBook = await resolveCanonicalBook(client, userId, entry.entityId);
    if ((keyBook?.id ?? entry.entityId) !== canonicalId)
      throw new Error("Conflicting book references");
    entityId = canonicalId;
  } else if (entry.entity === "bookmark") {
    entityId = remapBookmarkId(entityId, { fromId: bookId, toId: canonicalId });
  }
  return { ...entry, entityId, data: data ? { ...data, id: entityId, bookId: canonicalId } : data };
}

export async function withCanonicalBookWrite(
  userId: string,
  entry: ChangeEntry,
  write: (entry: ChangeEntry, client?: PoolClient) => Promise<WriteResult>,
): Promise<WriteResult> {
  if (
    !["book", "position", "notebook", "highlight", "bookmark", "chat_session"].includes(
      entry.entity,
    )
  )
    return write(entry);
  return withBookOwnerTransaction(
    userId,
    async (client) => {
      if (entry.entity === "book") {
        const canonicalId = await deduplicateBook(client, userId, entry);
        // Root alias snapshots never become canonical metadata writes.
        return canonicalId ? { accepted: true, canonicalId } : write(entry, client);
      }
      return write(await normalizeDependent(client, userId, entry), client);
    },
    (result) => result.accepted,
  );
}

/** Shared by sync and current server producers, including active chat tools. */
export async function withBookOwnerTransaction<T>(
  userId: string,
  execute: (client: PoolClient) => Promise<T>,
  shouldCommit: (result: T) => boolean = () => true,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      sql`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext('sync-book-alias'))`,
    );
    const result = await execute(client);
    await client.query(shouldCommit(result) ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}
