import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface ChallengeRow {
  id: string;
  userId: string | null;
  challenge: string;
  type: "registration" | "authentication";
  expiresAt: Date;
  createdAt: Date;
}

export interface SaveChallengeData {
  userId?: string | null;
  challenge: string;
  type: "registration" | "authentication";
  expiresAt: Date;
}

export async function saveChallenge(data: SaveChallengeData): Promise<ChallengeRow | null> {
  const pool = getPool();
  const result = await pool.query<ChallengeRow>(sql`
    INSERT INTO readmax.challenge (
      user_id, challenge, type, expires_at
    ) VALUES (
      ${data.userId ?? null},
      ${data.challenge},
      ${data.type},
      ${data.expiresAt.toISOString()}
    )
    RETURNING
      id,
      user_id AS "userId",
      challenge,
      type,
      expires_at AS "expiresAt",
      created_at AS "createdAt"
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getChallenge(challengeId: string): Promise<ChallengeRow | null> {
  const pool = getPool();
  const result = await pool.query<ChallengeRow>(sql`
    SELECT
      id,
      user_id AS "userId",
      challenge,
      type,
      expires_at AS "expiresAt",
      created_at AS "createdAt"
    FROM readmax.challenge
    WHERE id = ${challengeId}
      AND expires_at > NOW()
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function deleteChallenge(challengeId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.challenge
    WHERE id = ${challengeId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteExpiredChallenges(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.challenge
    WHERE expires_at <= NOW()
  `);
  return result.rowCount ?? 0;
}
