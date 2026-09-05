import { sql } from "pg-sql";
import { clampNullableTimestamp, clampUpdatedAt } from "../clamp-timestamp";
import { getPool } from "../pool";

export interface ChatSessionRow {
  id: string;
  userId: string;
  bookId: string | null;
  title: string | null;
  activeStreamId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  cursorTimestamp?: string;
}

export interface ChatMessageRow {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  parts: unknown | null;
  createdAt: Date;
  cursorTimestamp?: string;
}

const SESSION_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  title,
  active_stream_id AS "activeStreamId",
  created_at AS "createdAt",
  COALESCE(mutation_at, updated_at) AS "updatedAt",
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
  const mutationAt = session.updatedAt.toISOString();
  const createdAtIso = clampUpdatedAt(session.createdAt);
  const deletedAtIso = clampNullableTimestamp(session.deletedAt);
  const result = await pool.query<ChatSessionRow>(sql`
    INSERT INTO readmax.chat_session (id, user_id, book_id, title, created_at, updated_at, deleted_at, mutation_at)
    VALUES (
      ${session.id},
      ${userId},
      ${session.bookId ?? null},
      ${session.title ?? null},
      ${createdAtIso},
      clock_timestamp(),
      ${deletedAtIso},
      ${mutationAt}
    )
    ON CONFLICT (id) DO UPDATE
      SET book_id = EXCLUDED.book_id,
          title = EXCLUDED.title,
          updated_at = GREATEST(clock_timestamp(), readmax.chat_session.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at,
          deleted_at = EXCLUDED.deleted_at
      WHERE readmax.chat_session.user_id = EXCLUDED.user_id
        AND (EXCLUDED.mutation_at > COALESCE(readmax.chat_session.mutation_at, readmax.chat_session.updated_at)
          OR (EXCLUDED.mutation_at = COALESCE(readmax.chat_session.mutation_at, readmax.chat_session.updated_at)
              AND EXCLUDED.deleted_at IS NOT NULL AND readmax.chat_session.deleted_at IS NULL))
    RETURNING ${SESSION_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getSessionByIdForUser(
  sessionId: string,
  userId: string,
): Promise<ChatSessionRow | null> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}
    FROM readmax.chat_session
    WHERE id = ${sessionId}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `);
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

export async function getSessionsByUser(userId: string, limit?: number): Promise<ChatSessionRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}
    FROM readmax.chat_session
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getSessionsByUserAndBook(
  userId: string,
  bookId: string,
  limit?: number,
): Promise<ChatSessionRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}
    FROM readmax.chat_session
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getSessionsByUserSince(
  userId: string,
  cursor: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<ChatSessionRow[]> {
  const pool = getPool();
  const cursorTimestamp = exactCursorTimestamp ?? cursor.toISOString();
  const result = await pool.query<ChatSessionRow>(sql`
    SELECT ${SESSION_COLUMNS}, updated_at::text AS "cursorTimestamp"
    FROM readmax.chat_session
    WHERE user_id = ${userId}
      AND (
        updated_at > ${cursorTimestamp}
        OR (updated_at = ${cursorTimestamp} AND id > ${cursorId ?? null})
      )
    ORDER BY updated_at ASC, id ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function softDeleteSession(
  userId: string,
  sessionId: string,
  deletedAt?: Date,
): Promise<boolean> {
  const pool = getPool();
  const mutationAt = (deletedAt ?? new Date()).toISOString();
  const result = await pool.query(sql`
    INSERT INTO readmax.chat_session (id, user_id, deleted_at, updated_at, mutation_at)
    VALUES (${sessionId}, ${userId}, ${mutationAt}, clock_timestamp(), ${mutationAt})
    ON CONFLICT (id) DO UPDATE
      SET deleted_at = EXCLUDED.deleted_at,
          updated_at = GREATEST(clock_timestamp(), readmax.chat_session.updated_at + INTERVAL '1 microsecond'),
          mutation_at = EXCLUDED.mutation_at
      WHERE readmax.chat_session.user_id = EXCLUDED.user_id
        AND (EXCLUDED.mutation_at > COALESCE(readmax.chat_session.mutation_at, readmax.chat_session.updated_at)
          OR (EXCLUDED.mutation_at = COALESCE(readmax.chat_session.mutation_at, readmax.chat_session.updated_at)
              AND readmax.chat_session.deleted_at IS NULL))
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function updateActiveStreamId(
  userId: string,
  sessionId: string,
  activeStreamId: string | null,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    UPDATE readmax.chat_session
    SET active_stream_id = ${activeStreamId}
    WHERE id = ${sessionId}
      AND user_id = ${userId}
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

export async function getMessagesBySession(
  sessionId: string,
  limit?: number,
): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(sql`
    SELECT ${MESSAGE_COLUMNS}
    FROM readmax.chat_message
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}

export async function getMessagesBySessions(sessionIds: string[]): Promise<ChatMessageRow[]> {
  if (sessionIds.length === 0) return [];

  const pool = getPool();
  const result = await pool.query<ChatMessageRow>(sql`
    SELECT ${MESSAGE_COLUMNS}
    FROM readmax.chat_message
    WHERE session_id = ANY(${sessionIds})
    ORDER BY session_id ASC, created_at ASC
  `);
  return result.rows;
}

export async function getMessagesByUserSince(
  userId: string,
  cursor: Date,
  limit?: number,
  cursorId?: string | null,
  exactCursorTimestamp?: string,
): Promise<ChatMessageRow[]> {
  const pool = getPool();
  const cursorTimestamp = exactCursorTimestamp ?? cursor.toISOString();
  const result = await pool.query<ChatMessageRow>(sql`
    SELECT
      m.id,
      m.session_id AS "sessionId",
      m.role,
      m.content,
      m.parts,
      m.created_at AS "createdAt",
      m.created_at::text AS "cursorTimestamp"
    FROM readmax.chat_message m
    JOIN readmax.chat_session s ON s.id = m.session_id
    WHERE s.user_id = ${userId}
      AND (
        m.created_at > ${cursorTimestamp}
        OR (m.created_at = ${cursorTimestamp} AND m.id > ${cursorId ?? null})
      )
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT ${limit ?? null}
  `);
  return result.rows;
}
