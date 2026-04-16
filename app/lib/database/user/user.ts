import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface UserRow {
  id: string;
  displayName: string | null;
  createdAt: Date;
  lastSyncAt: Date | null;
}

export async function upsertUser(id: string, displayName?: string | null): Promise<UserRow | null> {
  const pool = getPool();
  const result = await pool.query<UserRow>(sql`
    INSERT INTO readmax.user (id, display_name)
    VALUES (${id}, ${displayName ?? null})
    ON CONFLICT (id) DO UPDATE
      SET display_name = COALESCE(EXCLUDED.display_name, readmax.user.display_name),
          last_sync_at = NOW()
    RETURNING
      id,
      display_name AS "displayName",
      created_at AS "createdAt",
      last_sync_at AS "lastSyncAt"
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getUser(id: string): Promise<UserRow | null> {
  const pool = getPool();
  const result = await pool.query<UserRow>(sql`
    SELECT
      id,
      display_name AS "displayName",
      created_at AS "createdAt",
      last_sync_at AS "lastSyncAt"
    FROM readmax.user
    WHERE id = ${id}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getUserByWebAuthnId(webauthnUserId: string): Promise<UserRow | null> {
  const pool = getPool();
  const result = await pool.query<UserRow>(sql`
    SELECT
      u.id,
      u.display_name AS "displayName",
      u.created_at AS "createdAt",
      u.last_sync_at AS "lastSyncAt"
    FROM readmax.user u
    INNER JOIN readmax.passkey p ON p.user_id = u.id
    WHERE p.webauthn_user_id = ${webauthnUserId}
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
