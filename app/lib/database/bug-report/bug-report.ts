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
  notes: string | null;
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
  statuses?: BugReportStatus[];
  q?: string;
  groupId?: string;
  limit?: number;
  offset?: number;
}

interface ListBugReportsResult {
  rows: BugReportRow[];
  count: number;
}

interface UpdateBugReportData {
  status?: BugReportStatus;
  notes?: string | null;
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
  notes,
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
  return updateBugReport(id, { status });
}

export async function updateBugReport(
  id: string,
  data: UpdateBugReportData,
): Promise<BugReportRow | null> {
  const shouldUpdateStatus = data.status !== undefined;
  const shouldUpdateNotes = data.notes !== undefined;
  const validStatus = shouldUpdateStatus
    ? assertBugReportStatus(data.status as BugReportStatus)
    : null;
  const pool = getPool();

  if (!shouldUpdateStatus && !shouldUpdateNotes) {
    const result = await pool.query<BugReportRow>(sql`
      SELECT ${BUG_REPORT_COLUMNS}
      FROM readmax.bug_report
      WHERE id = ${id}
    `);
    return result.rows[0] ?? null;
  }

  const result = await pool.query<BugReportRow>(sql`
    UPDATE readmax.bug_report
    SET status = CASE WHEN ${shouldUpdateStatus} THEN ${validStatus} ELSE status END,
        notes = CASE WHEN ${shouldUpdateNotes} THEN ${data.notes ?? null} ELSE notes END,
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
  statuses,
  q,
  groupId,
  limit,
  offset,
}: ListBugReportsOptions = {}): Promise<ListBugReportsResult> {
  const validStatuses = normalizeStatuses(status, statuses);
  const pageLimit = normalizeLimit(limit);
  const pageOffset = normalizeOffset(offset);
  const searchPattern = normalizeSearchPattern(q);
  const hasStatusFilter = validStatuses.length > 0;
  const hasGroupIdFilter = groupId != null;
  const hasSearchFilter = searchPattern != null;
  const pool = getPool();

  const [result, countResult] = await Promise.all([
    pool.query<BugReportRow>(sql`
      SELECT ${BUG_REPORT_COLUMNS}
      FROM readmax.bug_report
      WHERE (${hasStatusFilter} = FALSE OR status = ANY(${validStatuses}::text[]))
        AND (${hasGroupIdFilter} = FALSE OR group_id = ${groupId ?? null})
        AND (
          ${hasSearchFilter} = FALSE
          OR message ILIKE ${searchPattern}
          OR notes ILIKE ${searchPattern}
        )
      ORDER BY created_at DESC
      LIMIT ${pageLimit}
      OFFSET ${pageOffset}
    `),
    pool.query<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM readmax.bug_report
      WHERE (${hasStatusFilter} = FALSE OR status = ANY(${validStatuses}::text[]))
        AND (${hasGroupIdFilter} = FALSE OR group_id = ${groupId ?? null})
        AND (
          ${hasSearchFilter} = FALSE
          OR message ILIKE ${searchPattern}
          OR notes ILIKE ${searchPattern}
        )
    `),
  ]);

  return {
    rows: result.rows,
    count: Number(countResult.rows[0]?.count ?? 0),
  };
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

function normalizeStatuses(
  status: BugReportStatus | undefined,
  statuses: BugReportStatus[] | undefined,
): BugReportStatus[] {
  if (statuses != null) {
    return [...new Set(statuses.map(assertBugReportStatus))];
  }
  if (status == null) return [];
  return [assertBugReportStatus(status)];
}

function normalizeSearchPattern(q: string | undefined): string | null {
  const trimmed = q?.trim();
  if (!trimmed) return null;
  return `%${trimmed}%`;
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
