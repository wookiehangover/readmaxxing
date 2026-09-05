import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface UserSettingsRow {
  userId: string;
  settings: unknown;
  updatedAt: Date;
  cursorTimestamp?: string;
}

const SETTINGS_COLUMNS = sql`
  user_id AS "userId",
  settings,
  COALESCE(mutation_at, updated_at) AS "updatedAt"
`;

export async function upsertSettings(
  userId: string,
  settings: unknown,
  updatedAt: Date,
): Promise<UserSettingsRow | null> {
  const pool = getPool();
  const mutationAt = updatedAt.toISOString();
  const result = await pool.query<UserSettingsRow>(sql`
    INSERT INTO readmax.user_settings (user_id, settings, updated_at, mutation_at)
    VALUES (${userId}, ${JSON.stringify(settings)}::jsonb, clock_timestamp(), ${mutationAt})
    ON CONFLICT (user_id) DO UPDATE
      SET settings = EXCLUDED.settings,
          updated_at = GREATEST(clock_timestamp(), readmax.user_settings.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at
      WHERE EXCLUDED.mutation_at > COALESCE(readmax.user_settings.mutation_at, readmax.user_settings.updated_at)
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
  exactCursorTimestamp?: string,
): Promise<UserSettingsRow | null> {
  const pool = getPool();
  const result = await pool.query<UserSettingsRow>(sql`
    SELECT ${SETTINGS_COLUMNS}, updated_at::text AS "cursorTimestamp"
    FROM readmax.user_settings
    WHERE user_id = ${userId}
      AND updated_at > ${exactCursorTimestamp ?? cursor.toISOString()}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}
