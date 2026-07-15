import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface MagicLinkRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateMagicLinkData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export async function createMagicLink(data: CreateMagicLinkData): Promise<MagicLinkRow | null> {
  const pool = getPool();
  const result = await pool.query<MagicLinkRow>(sql`
    INSERT INTO readmax.magic_link (user_id, token_hash, expires_at)
    VALUES (${data.userId}, ${data.tokenHash}, ${data.expiresAt.toISOString()})
    RETURNING
      id,
      user_id AS "userId",
      token_hash AS "tokenHash",
      expires_at AS "expiresAt",
      created_at AS "createdAt"
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function replaceMagicLinkForUser(
  data: CreateMagicLinkData,
): Promise<MagicLinkRow | null> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql`
      DELETE FROM readmax.magic_link
      WHERE user_id = ${data.userId}
    `);
    const result = await client.query<MagicLinkRow>(sql`
      INSERT INTO readmax.magic_link (user_id, token_hash, expires_at)
      VALUES (${data.userId}, ${data.tokenHash}, ${data.expiresAt.toISOString()})
      RETURNING
        id,
        user_id AS "userId",
        token_hash AS "tokenHash",
        expires_at AS "expiresAt",
        created_at AS "createdAt"
    `);
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getMagicLinkByHash(tokenHash: string): Promise<MagicLinkRow | null> {
  const pool = getPool();
  const result = await pool.query<MagicLinkRow>(sql`
    SELECT
      id,
      user_id AS "userId",
      token_hash AS "tokenHash",
      expires_at AS "expiresAt",
      created_at AS "createdAt"
    FROM readmax.magic_link
    WHERE token_hash = ${tokenHash}
      AND expires_at > NOW()
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function deleteMagicLinksForUser(userId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.magic_link
    WHERE user_id = ${userId}
  `);
  return result.rowCount ?? 0;
}

export async function deleteExpiredMagicLinks(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.magic_link
    WHERE expires_at <= NOW()
  `);
  return result.rowCount ?? 0;
}
