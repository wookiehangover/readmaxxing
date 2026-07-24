import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface PasskeyRow {
  id: string;
  userId: string;
  publicKey: Buffer;
  webauthnUserId: string;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string | null;
  name: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface SavePasskeyData {
  id: string;
  userId: string;
  publicKey: Buffer;
  webauthnUserId: string;
  counter: number;
  deviceType?: string | null;
  backedUp?: boolean;
  transports?: string | null;
}

export async function savePasskey(data: SavePasskeyData): Promise<PasskeyRow | null> {
  const pool = getPool();
  const result = await pool.query<PasskeyRow>(sql`
    INSERT INTO readmax.passkey (
      id, user_id, public_key, webauthn_user_id,
      counter, device_type, backed_up, transports
    ) VALUES (
      ${data.id},
      ${data.userId},
      ${data.publicKey},
      ${data.webauthnUserId},
      ${data.counter},
      ${data.deviceType ?? null},
      ${data.backedUp ?? false},
      ${data.transports ?? null}
    )
    RETURNING
      id,
      user_id AS "userId",
      public_key AS "publicKey",
      webauthn_user_id AS "webauthnUserId",
      counter,
      device_type AS "deviceType",
      backed_up AS "backedUp",
      transports,
      name,
      last_used_at AS "lastUsedAt",
      created_at AS "createdAt"
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getPasskeysByUserId(userId: string): Promise<PasskeyRow[]> {
  const pool = getPool();
  const result = await pool.query<PasskeyRow>(sql`
    SELECT
      id,
      user_id AS "userId",
      public_key AS "publicKey",
      webauthn_user_id AS "webauthnUserId",
      counter,
      device_type AS "deviceType",
      backed_up AS "backedUp",
      transports,
      name,
      last_used_at AS "lastUsedAt",
      created_at AS "createdAt"
    FROM readmax.passkey
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `);

  return result.rows;
}

export async function getPasskeyById(credentialId: string): Promise<PasskeyRow | null> {
  const pool = getPool();
  const result = await pool.query<PasskeyRow>(sql`
    SELECT
      id,
      user_id AS "userId",
      public_key AS "publicKey",
      webauthn_user_id AS "webauthnUserId",
      counter,
      device_type AS "deviceType",
      backed_up AS "backedUp",
      transports,
      name,
      last_used_at AS "lastUsedAt",
      created_at AS "createdAt"
    FROM readmax.passkey
    WHERE id = ${credentialId}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function updatePasskeyCounter(
  credentialId: string,
  counter: number,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.passkey
    SET counter = ${counter}
    WHERE id = ${credentialId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function deletePasskey(id: string, userId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.passkey
    WHERE id = ${id}
      AND user_id = ${userId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function deletePasskeyIfNotLast(
  id: string,
  userId: string,
): Promise<"deleted" | "not_found" | "last_passkey"> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.passkey
    WHERE id = ${id}
      AND user_id = ${userId}
      AND (SELECT COUNT(*) FROM readmax.passkey WHERE user_id = ${userId}) > 1
  `);
  if ((result.rowCount ?? 0) > 0) return "deleted";
  const exists = await pool.query<{ count: string }>(sql`
    SELECT COUNT(*) AS count FROM readmax.passkey
    WHERE id = ${id} AND user_id = ${userId}
  `);
  return Number(exists.rows[0]?.count ?? 0) > 0 ? "last_passkey" : "not_found";
}

export async function updatePasskeyName(
  id: string,
  userId: string,
  name: string | null,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.passkey
    SET name = ${name}
    WHERE id = ${id}
      AND user_id = ${userId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function countPasskeysByUserId(userId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(sql`
    SELECT COUNT(*) AS count
    FROM readmax.passkey
    WHERE user_id = ${userId}
  `);
  return Number(result.rows[0]?.count ?? 0);
}

export async function touchPasskeyLastUsed(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.passkey
    SET last_used_at = NOW()
    WHERE id = ${id}
  `);
  return (result.rowCount ?? 0) > 0;
}
