import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function createSession(userId: string, expiresAt: Date): Promise<SessionRow | null> {
  const pool = getPool();
  const result = await pool.query<SessionRow>(sql`
    INSERT INTO readmax.session (user_id, expires_at)
    VALUES (${userId}, ${expiresAt.toISOString()})
    RETURNING
      id,
      user_id AS "userId",
      expires_at AS "expiresAt",
      created_at AS "createdAt"
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const pool = getPool();
  const result = await pool.query<SessionRow>(sql`
    SELECT
      id,
      user_id AS "userId",
      expires_at AS "expiresAt",
      created_at AS "createdAt"
    FROM readmax.session
    WHERE id = ${sessionId}
      AND expires_at > NOW()
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.session
    WHERE id = ${sessionId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteExpiredSessions(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.session
    WHERE expires_at <= NOW()
  `);
  return result.rowCount ?? 0;
}
