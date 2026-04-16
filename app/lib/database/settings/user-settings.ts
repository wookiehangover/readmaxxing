import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface UserSettingsRow {
  userId: string;
  settings: unknown;
  updatedAt: Date;
}

const SETTINGS_COLUMNS = sql`
  user_id AS "userId",
  settings,
  updated_at AS "updatedAt"
`;

export async function upsertSettings(
  userId: string,
  settings: unknown,
  updatedAt: Date,
): Promise<UserSettingsRow | null> {
  const pool = getPool();
  const result = await pool.query<UserSettingsRow>(sql`
    INSERT INTO readmax.user_settings (user_id, settings, updated_at)
    VALUES (${userId}, ${JSON.stringify(settings)}::jsonb, ${updatedAt.toISOString()})
    ON CONFLICT (user_id) DO UPDATE
      SET settings = EXCLUDED.settings,
          updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.updated_at > readmax.user_settings.updated_at
    RETURNING ${SETTINGS_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSettings(userId: string): Promise<UserSettingsRow | null> {
  const pool = getPool();
  const result = await pool.query<UserSettingsRow>(sql`
    SELECT ${SETTINGS_COLUMNS}
    FROM readmax.user_settings
    WHERE user_id = ${userId}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSettingsSince(
  userId: string,
  cursor: Date,
): Promise<UserSettingsRow | null> {
  const pool = getPool();
  const result = await pool.query<UserSettingsRow>(sql`
    SELECT ${SETTINGS_COLUMNS}
    FROM readmax.user_settings
    WHERE user_id = ${userId}
      AND updated_at > ${cursor.toISOString()}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
