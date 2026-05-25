import { sql } from "pg-sql";
import { getPool } from "../pool";

export interface ShareLinkRow {
  id: string;
  userId: string;
  bookId: string;
  maxUses: number | null;
  useCount: number;
  shareChats: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreateShareLinkData {
  id: string;
  userId: string;
  bookId: string;
  maxUses?: number | null;
  shareChats?: boolean;
  expiresAt?: Date | null;
}

const SHARE_LINK_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  max_uses AS "maxUses",
  use_count AS "useCount",
  share_chats AS "shareChats",
  created_at AS "createdAt",
  expires_at AS "expiresAt"
`;

export async function createShareLink(
  shareLink: CreateShareLinkData,
): Promise<ShareLinkRow | null> {
  const pool = getPool();
  const result = await pool.query<ShareLinkRow>(sql`
    INSERT INTO readmax.share_link (id, user_id, book_id, max_uses, share_chats, expires_at)
    VALUES (
      ${shareLink.id},
      ${shareLink.userId},
      ${shareLink.bookId},
      ${shareLink.maxUses ?? null},
      ${shareLink.shareChats ?? false},
      ${shareLink.expiresAt?.toISOString() ?? null}
    )
    RETURNING ${SHARE_LINK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getShareLink(id: string): Promise<ShareLinkRow | null> {
  const pool = getPool();
  const result = await pool.query<ShareLinkRow>(sql`
    SELECT ${SHARE_LINK_COLUMNS}
    FROM readmax.share_link
    WHERE id = ${id}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function incrementUseCount(id: string): Promise<ShareLinkRow | null> {
  const pool = getPool();
  const result = await pool.query<ShareLinkRow>(sql`
    UPDATE readmax.share_link
    SET use_count = use_count + 1
    WHERE id = ${id}
      AND (max_uses IS NULL OR use_count < max_uses)
    RETURNING ${SHARE_LINK_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function getShareLinksForBook(
  userId: string,
  bookId: string,
): Promise<ShareLinkRow[]> {
  const pool = getPool();
  const result = await pool.query<ShareLinkRow>(sql`
    SELECT ${SHARE_LINK_COLUMNS}
    FROM readmax.share_link
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
    ORDER BY created_at DESC
  `);
  return result.rows;
}

export async function deleteShareLink(userId: string, id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(sql`
    DELETE FROM readmax.share_link
    WHERE id = ${id}
      AND user_id = ${userId}
  `);
  return (result.rowCount ?? 0) > 0;
}
