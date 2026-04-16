import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface ChatSessionRow {
  id: string;
  userId: string;
  bookId: string | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  parts: unknown | null;
  createdAt: Date;
}

const SESSION_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  title,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"
`;

const MESSAGE_COLUMNS = sql`
  id,
  session_id AS "sessionId",
  role,
  content,
  parts,
  created_at AS "createdAt"
`;

export async function upsertSession(
  userId: string,
  session: {
    id: string;
    bookId?: string | null;
    title?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
  },
): Promise<ChatSessionRow | null> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    INSERT INTO readmax.chat_session (id, user_id, book_id, title, created_at, updated_at, deleted_at)
    VALUES (
      ${session.id},
      ${userId},
      ${session.bookId ?? null},
      ${session.title ?? null},
      ${session.createdAt.toISOString()},
      ${session.updatedAt.toISOString()},
      ${session.deletedAt?.toISOString() ?? null}
    )
    ON CONFLICT (id) DO UPDATE
      SET book_id = EXCLUDED.book_id,
          title = EXCLUDED.title,
          updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at
    RETURNING ${SESSION_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSessionsByUser(userId: string): Promise<ChatSessionRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}
    FROM readmax.chat_session
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
  `);
  return result.rows;
}

export async function getSessionsByUserSince(
  userId: string,
  cursor: Date,
): Promise<ChatSessionRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}
    FROM readmax.chat_session
    WHERE user_id = ${userId}
      AND updated_at > ${cursor.toISOString()}
    ORDER BY updated_at ASC
  `);
  return result.rows;
}

export async function softDeleteSession(userId: string, sessionId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.chat_session
    SET deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = ${sessionId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function upsertMessage(message: {
  id: string;
  sessionId: string;
  role: string;
  content?: string | null;
  parts?: unknown | null;
  createdAt: Date;
}): Promise<ChatMessageRow | null> {
  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(sql`
    INSERT INTO readmax.chat_message (id, session_id, role, content, parts, created_at)
    VALUES (
      ${message.id},
      ${message.sessionId},
      ${message.role},
      ${message.content ?? null},
      ${message.parts ? JSON.stringify(message.parts) : null}::jsonb,
      ${message.createdAt.toISOString()}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING ${MESSAGE_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getMessagesBySession(sessionId: string): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(sql`
    SELECT ${MESSAGE_COLUMNS}
    FROM readmax.chat_message
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `);
  return result.rows;
}

export async function getMessagesByUserSince(
  userId: string,
  cursor: Date,
): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(sql`
    SELECT
      m.id,
      m.session_id AS "sessionId",
      m.role,
      m.content,
      m.parts,
      m.created_at AS "createdAt"
    FROM readmax.chat_message m
    JOIN readmax.chat_session s ON s.id = m.session_id
    WHERE s.user_id = ${userId}
      AND m.created_at > ${cursor.toISOString()}
    ORDER BY m.created_at ASC
  `);
  return result.rows;
}
