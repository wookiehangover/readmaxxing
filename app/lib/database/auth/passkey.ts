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
