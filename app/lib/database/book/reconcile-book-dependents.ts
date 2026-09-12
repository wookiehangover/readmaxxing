import type { PoolClient } from "pg";
import { sql } from "pg-sql";
import { remapBookmarkId } from "~/lib/sync/remap-references";
import { upsertNotebook } from "../annotation/notebook";
import { upsertBookmark, type BookmarkRow } from "../bookmark/bookmark";
import { upsertPosition } from "./reading-position";

/** The caller holds the user's sync transaction lock. Never change source clocks. */
export async function reconcileBookDependents(
  client: PoolClient,
  userId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  const notebooks = await client.query<{ content: unknown; updatedAt: Date }>(sql`
    SELECT content, COALESCE(mutation_at, updated_at) AS "updatedAt"
    FROM readmax.notebook WHERE user_id = ${userId} AND book_id = ${fromId} FOR UPDATE
  `);
  for (const row of notebooks.rows) {
    await upsertNotebook(userId, toId, row.content, row.updatedAt, client);
    // Even when the existing target wins, publish it after the losing row moves.
    await client.query(sql`
      UPDATE readmax.notebook SET mutation_at = COALESCE(mutation_at, updated_at),
        updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
      WHERE user_id = ${userId} AND book_id = ${toId}
    `);
    await client.query(
      sql`DELETE FROM readmax.notebook WHERE user_id = ${userId} AND book_id = ${fromId}`,
    );
  }

  const positions = await client.query<{ cfi: string | null; updatedAt: Date }>(sql`
    SELECT cfi, COALESCE(mutation_at, updated_at) AS "updatedAt"
    FROM readmax.reading_position WHERE user_id = ${userId} AND book_id = ${fromId} FOR UPDATE
  `);
  for (const row of positions.rows) {
    await upsertPosition(userId, toId, row.cfi, row.updatedAt, client);
    await client.query(sql`
      UPDATE readmax.reading_position SET mutation_at = COALESCE(mutation_at, updated_at),
        updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
      WHERE user_id = ${userId} AND book_id = ${toId}
    `);
    await client.query(
      sql`DELETE FROM readmax.reading_position WHERE user_id = ${userId} AND book_id = ${fromId}`,
    );
  }

  const bookmarks = await client.query<BookmarkRow>(sql`
    SELECT id, book_id AS "bookId", cfi, label, page_number AS "pageNumber", display_page AS "displayPage",
      created_at AS "createdAt", COALESCE(mutation_at, updated_at) AS "updatedAt", deleted_at AS "deletedAt"
    FROM readmax.bookmark WHERE user_id = ${userId} AND book_id = ${fromId} FOR UPDATE
  `);
  for (const row of bookmarks.rows) {
    const id = remapBookmarkId(row.id, { fromId, toId });
    if (id !== row.id) {
      const target = await client.query<{ userId: string }>(sql`
        SELECT user_id AS "userId" FROM readmax.bookmark WHERE id = ${id} FOR UPDATE
      `);
      if (target.rows[0] && target.rows[0].userId !== userId) {
        throw new Error("Canonical bookmark belongs to another user");
      }
      await upsertBookmark(userId, { ...row, id, bookId: toId }, client);
      await client.query(
        sql`DELETE FROM readmax.bookmark WHERE id = ${row.id} AND user_id = ${userId}`,
      );
    }
    await client.query(sql`
      UPDATE readmax.bookmark SET book_id = ${toId}, mutation_at = COALESCE(mutation_at, updated_at),
        updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
      WHERE id = ${id} AND user_id = ${userId}
    `);
  }

  // These entity IDs are global and unchanged: move only their parent reference.
  // This also preserves tombstones, immutable metadata and active chat streams.
  await client.query(sql`
    UPDATE readmax.highlight SET book_id = ${toId}, mutation_at = COALESCE(mutation_at, updated_at),
      updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
    WHERE user_id = ${userId} AND book_id = ${fromId}
  `);
  await client.query(sql`
    UPDATE readmax.chat_session SET book_id = ${toId}, mutation_at = COALESCE(mutation_at, updated_at),
      updated_at = GREATEST(clock_timestamp(), updated_at + INTERVAL '1 microsecond')
    WHERE user_id = ${userId} AND book_id = ${fromId}
  `);
}
