import { sql } from "pg-sql";
import { getPool } from "../pool";

export const BUG_REPORT_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "closed",
  "wont_fix",
] as const;

export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number];

export interface BugReportRow {
  id: string;
  userId: string;
  message: string;
  context: Record<string, unknown> | null;
  status: BugReportStatus;
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BugReportGroupRow {
  id: string;
  title: string | null;
  status: BugReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface InsertBugReportData {
  userId: string;
  message: string;
  context?: Record<string, unknown> | null;
}

interface ListBugReportsOptions {
  status?: BugReportStatus;
  groupId?: string;
  limit?: number;
  offset?: number;
}

interface CreateBugReportGroupData {
  title?: string | null;
  status?: BugReportStatus;
}

const BUG_REPORT_COLUMNS = sql`
  id,
  user_id AS "userId",
  message,
  context,
  status,
  group_id AS "groupId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const BUG_REPORT_GROUP_COLUMNS = sql`
  id,
  title,
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export async function insertBugReport(data: InsertBugReportData): Promise<BugReportRow | null> {
  const pool = getPool();
  const contextJson = data.context == null ? null : JSON.stringify(data.context);
  const result = await pool.query<BugReportRow>(sql`
    INSERT INTO readmax.bug_report (user_id, message, context)
    VALUES (${data.userId}, ${data.message}, ${contextJson}::jsonb)
    RETURNING ${BUG_REPORT_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function updateBugReportStatus(
  id: string,
  status: BugReportStatus,
): Promise<BugReportRow | null> {
  const validStatus = assertBugReportStatus(status);
  const pool = getPool();
  const result = await pool.query<BugReportRow>(sql`
    UPDATE readmax.bug_report
    SET status = ${validStatus},
        updated_at = NOW()
    WHERE id = ${id}
    RETURNING ${BUG_REPORT_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function listBugReports({
  status,
  groupId,
  limit,
  offset,
}: ListBugReportsOptions = {}): Promise<BugReportRow[]> {
  const validStatus = status == null ? null : assertBugReportStatus(status);
  const pageLimit = normalizeLimit(limit);
  const pageOffset = normalizeOffset(offset);
  const pool = getPool();

  if (validStatus && groupId) {
    const result = await pool.query<BugReportRow>(sql`
      SELECT ${BUG_REPORT_COLUMNS}
      FROM readmax.bug_report
      WHERE status = ${validStatus}
        AND group_id = ${groupId}
      ORDER BY created_at DESC
      LIMIT ${pageLimit}
      OFFSET ${pageOffset}
    `);
    return result.rows;
  }

  if (validStatus) {
    const result = await pool.query<BugReportRow>(sql`
      SELECT ${BUG_REPORT_COLUMNS}
      FROM readmax.bug_report
      WHERE status = ${validStatus}
      ORDER BY created_at DESC
      LIMIT ${pageLimit}
      OFFSET ${pageOffset}
    `);
    return result.rows;
  }

  if (groupId) {
    const result = await pool.query<BugReportRow>(sql`
      SELECT ${BUG_REPORT_COLUMNS}
      FROM readmax.bug_report
      WHERE group_id = ${groupId}
      ORDER BY created_at DESC
      LIMIT ${pageLimit}
      OFFSET ${pageOffset}
    `);
    return result.rows;
  }

  const result = await pool.query<BugReportRow>(sql`
    SELECT ${BUG_REPORT_COLUMNS}
    FROM readmax.bug_report
    ORDER BY created_at DESC
    LIMIT ${pageLimit}
    OFFSET ${pageOffset}
  `);
  return result.rows;
}

export async function createBugReportGroup(
  data: CreateBugReportGroupData = {},
): Promise<BugReportGroupRow | null> {
  const status = data.status == null ? "new" : assertBugReportStatus(data.status);
  const pool = getPool();
  const result = await pool.query<BugReportGroupRow>(sql`
    INSERT INTO readmax.bug_report_group (title, status)
    VALUES (${data.title ?? null}, ${status})
    RETURNING ${BUG_REPORT_GROUP_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function assignBugReportToGroup(
  reportId: string,
  groupId: string,
): Promise<BugReportRow | null> {
  const pool = getPool();
  const result = await pool.query<BugReportRow>(sql`
    UPDATE readmax.bug_report
    SET group_id = ${groupId},
        updated_at = NOW()
    WHERE id = ${reportId}
    RETURNING ${BUG_REPORT_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

export async function updateBugReportGroupStatus(
  groupId: string,
  status: BugReportStatus,
): Promise<BugReportGroupRow | null> {
  const validStatus = assertBugReportStatus(status);
  const pool = getPool();
  const result = await pool.query<BugReportGroupRow>(sql`
    UPDATE readmax.bug_report_group
    SET status = ${validStatus},
        updated_at = NOW()
    WHERE id = ${groupId}
    RETURNING ${BUG_REPORT_GROUP_COLUMNS}
  `);

  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

function assertBugReportStatus(status: string): BugReportStatus {
  if (BUG_REPORT_STATUSES.includes(status as BugReportStatus)) {
    return status as BugReportStatus;
  }
  throw new Error(`Invalid bug report status: ${status}`);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null) return 50;
  if (!Number.isInteger(limit) || limit < 1) return 50;
  return Math.min(limit, 100);
}

function normalizeOffset(offset: number | undefined): number {
  if (offset == null) return 0;
  if (!Number.isInteger(offset) || offset < 0) return 0;
  return offset;
}
