import { inspectOwnership } from "./ownership";
import { sql } from "pg-sql";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import type { BookAliasPage } from "~/lib/sync/delivery-types";

export async function listBookAliases(
  account: string,
  cursor: string | null,
  limit = 100,
): Promise<BookAliasPage> {
  return withBookOwnerTransaction(account, async (client) => {
    await client.query(
      sql`INSERT INTO readmax.sync_alias_revision(account_id) VALUES(${account}) ON CONFLICT DO NOTHING`,
    );
    const state = (
      await client.query<{ revision: string; bootstrapped: boolean }>(
        sql`SELECT revision::text,bootstrapped FROM readmax.sync_alias_revision WHERE account_id=${account} FOR UPDATE`,
      )
    ).rows[0];
    if (!state.bootstrapped) {
      // Reserve a contiguous commit-ordered range. Existing events may repeat;
      // clients persist idempotent intents and never infer ordinary tombstones.
      await client.query(sql`WITH missing AS (
        SELECT id,canonical_id,row_number() OVER(ORDER BY id) AS n FROM readmax.book
        WHERE user_id=${account} AND canonical_id IS NOT NULL
      ) INSERT INTO readmax.sync_alias_event(account_id,revision,from_id,to_id)
        SELECT ${account},${state.revision}::bigint+n,id,canonical_id FROM missing`);
      await client.query(sql`UPDATE readmax.sync_alias_revision SET bootstrapped=true,
        revision=COALESCE((SELECT max(revision) FROM readmax.sync_alias_event WHERE account_id=${account}),0) WHERE account_id=${account}`);
    }
    const high = (
      await client.query<{ revision: string }>(
        sql`SELECT revision::text FROM readmax.sync_alias_revision WHERE account_id=${account}`,
      )
    ).rows[0].revision;
    let after = "0",
      until = high;
    if (cursor) {
      const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString()) as {
        account: string;
        after: string;
        until: string;
        done: boolean;
      };
      if (
        decoded.account !== account ||
        !/^\d+$/.test(decoded.after) ||
        !/^\d+$/.test(decoded.until)
      )
        throw new TypeError("Invalid alias cursor");
      after = decoded.after;
      until = decoded.done ? high : decoded.until;
    }
    const rows = (
      await client.query<
        BookAliasPage["aliases"][number]
      >(sql`SELECT from_id AS "fromId",to_id AS "toId",revision::text AS version
      FROM readmax.sync_alias_event WHERE account_id=${account} AND revision>${after}::bigint AND revision<=${until}::bigint
      ORDER BY revision LIMIT ${Math.max(1, Math.min(100, limit)) + 1}`)
    ).rows;
    const hasMore = rows.length > limit;
    const aliases = rows.slice(0, limit);
    for (const alias of aliases) {
      const owned = await inspectOwnership(client, account, {
        entity: "book",
        entityId: alias.fromId,
        data: { bookId: alias.toId },
      });
      const target = await client.query(
        sql`SELECT id FROM readmax.book WHERE id=${alias.toId} AND user_id=${account}`,
      );
      if (!owned.owned || owned.malformedAlias || !target.rows.length)
        throw new Error("Alias recovery evidence unavailable");
    }
    const next = hasMore ? aliases.at(-1)!.version : until;
    return {
      ownerId: account,
      aliases,
      hasMore,
      cursor: Buffer.from(JSON.stringify({ account, after: next, until, done: !hasMore })).toString(
        "base64url",
      ),
    };
  });
}
