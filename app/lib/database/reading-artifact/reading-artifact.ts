import { sql } from "pg-sql";
import type { PoolClient } from "pg";
import { getPool } from "../pool";

export type ReadingUnitKind = "epub-spine" | "pdf-page";
export type ReadingIngestStatus = "pending" | "processing" | "done" | "skipped" | "error";
export type ReadingArtifactKind = "outline" | "characters" | "wiki";
export type ReadingArtifactActor = "agent" | "user";

export interface ReadingIngestUnitRow {
  id: string;
  userId: string;
  bookId: string;
  fingerprint: string;
  unitKind: ReadingUnitKind;
  locator: string;
  chapterLabel: string | null;
  text: string;
  status: ReadingIngestStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  attemptCount: number;
  claimedAt: Date | null;
  nextAttemptAt: Date;
  processedAt: Date | null;
  error: string | null;
}

export interface ReadingAgentLeaseRow {
  userId: string;
  unitId: string;
  bookId: string;
  expiresAt: Date;
}

export interface ReadingAgentStatusLeaseRow {
  unitId: string;
  bookId: string;
  expiresAt: Date;
  chapterLabel: string | null;
  locator: string;
}

export interface ReadingAgentStatusUnitRow {
  unitId: string;
  bookId: string;
  chapterLabel: string | null;
  locator: string;
  unitKind: ReadingUnitKind;
  status: ReadingIngestStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  claimedAt: Date | null;
  lastSeenAt: Date;
  lastError: string | null;
}

export interface ReadingAgentSchemaHealth {
  ok: boolean;
  missingColumns?: string[];
}

export interface ReadingIngestUnitLease {
  unit: ReadingIngestUnitRow;
  lease: ReadingAgentLeaseRow;
}

export interface ReadingAgentUsageRow {
  id: string;
  unitId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: string;
  model: string | null;
  source: string;
  createdAt: Date;
}

export interface ReadingAgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number | string;
  model?: string | null;
  source: string;
}

export interface ReadingArtifactRevisionRow {
  id: string;
  userId: string;
  bookId: string;
  kind: ReadingArtifactKind;
  content: string;
  previousRevisionId: string | null;
  actor: ReadingArtifactActor;
  sourceUnitId: string;
  sourceFingerprint: string;
  summary: string;
  createdAt: Date;
}

export interface ReadingArtifactRow {
  userId: string;
  bookId: string;
  kind: ReadingArtifactKind;
  content: string;
  revisionId: string;
  updatedAt: Date;
}

export interface ReadingArtifactUpdate {
  kind: ReadingArtifactKind;
  content: string;
  summary: string;
}

const READING_AGENT_LEASE_TTL_MS = 4 * 60 * 1000;
const READING_AGENT_MAX_ATTEMPTS = 8;
const READING_AGENT_SCHEMA_COLUMNS = {
  reading_ingest_unit: ["attempt_count", "claimed_at", "next_attempt_at"],
  reading_agent_lease: ["user_id", "unit_id", "book_id", "expires_at"],
  reading_agent_usage: [
    "id",
    "unit_id",
    "input",
    "output",
    "cache_read",
    "cache_write",
    "total_tokens",
    "cost_total",
    "model",
    "source",
    "created_at",
  ],
} as const;

export function readingAgentRetryDelaySeconds(attempt: number): number {
  return Math.min(5 * 60, 10 * 2 ** Math.max(0, attempt - 1));
}

const INGEST_UNIT_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  fingerprint,
  unit_kind AS "unitKind",
  locator,
  chapter_label AS "chapterLabel",
  text,
  status,
  first_seen_at AS "firstSeenAt",
  last_seen_at AS "lastSeenAt",
  attempt_count AS "attemptCount",
  claimed_at AS "claimedAt",
  next_attempt_at AS "nextAttemptAt",
  processed_at AS "processedAt",
  error
`;

const LEASE_COLUMNS = sql`
  user_id AS "userId",
  unit_id AS "unitId",
  book_id AS "bookId",
  expires_at AS "expiresAt"
`;

const USAGE_COLUMNS = sql`
  id,
  unit_id AS "unitId",
  input,
  output,
  cache_read AS "cacheRead",
  cache_write AS "cacheWrite",
  total_tokens AS "totalTokens",
  cost_total AS "costTotal",
  model,
  source,
  created_at AS "createdAt"
`;

const REVISION_COLUMNS = sql`
  id,
  user_id AS "userId",
  book_id AS "bookId",
  kind,
  content,
  previous_revision_id AS "previousRevisionId",
  actor,
  source_unit_id AS "sourceUnitId",
  source_fingerprint AS "sourceFingerprint",
  summary,
  created_at AS "createdAt"
`;

const ARTIFACT_COLUMNS = sql`
  user_id AS "userId",
  book_id AS "bookId",
  kind,
  content,
  revision_id AS "revisionId",
  updated_at AS "updatedAt"
`;

export async function insertReadingIngestUnit(data: {
  userId: string;
  bookId: string;
  fingerprint: string;
  unitKind: ReadingUnitKind;
  locator: string;
  chapterLabel?: string | null;
  text: string;
}): Promise<ReadingIngestUnitRow | null> {
  const result = await getPool().query<ReadingIngestUnitRow>(sql`
    INSERT INTO readmax.reading_ingest_unit (
      user_id, book_id, fingerprint, unit_kind, locator, chapter_label, text
    )
    VALUES (
      ${data.userId},
      ${data.bookId},
      ${data.fingerprint},
      ${data.unitKind},
      ${data.locator},
      ${data.chapterLabel ?? null},
      ${data.text}
    )
    ON CONFLICT (user_id, book_id, fingerprint) DO NOTHING
    RETURNING ${INGEST_UNIT_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function getReadingIngestUnitByFingerprint(
  userId: string,
  bookId: string,
  fingerprint: string,
): Promise<ReadingIngestUnitRow | null> {
  const result = await getPool().query<ReadingIngestUnitRow>(sql`
    SELECT ${INGEST_UNIT_COLUMNS}
    FROM readmax.reading_ingest_unit
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
      AND fingerprint = ${fingerprint}
  `);
  return result.rows[0] ?? null;
}

export async function getReadingAgentSchemaHealth(): Promise<ReadingAgentSchemaHealth> {
  const result = await getPool().query<{ tableName: string; columnName: string }>(sql`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'readmax'
      AND table_name IN ('reading_ingest_unit', 'reading_agent_lease', 'reading_agent_usage')
  `);
  const present = new Set(result.rows.map((row) => `${row.tableName}.${row.columnName}`));
  const missingColumns = Object.entries(READING_AGENT_SCHEMA_COLUMNS)
    .flatMap(([table, columns]) => columns.map((column) => `${table}.${column}`))
    .filter((column) => !present.has(column));
  return missingColumns.length > 0 ? { ok: false, missingColumns } : { ok: true };
}

export async function getCurrentReadingAgentLease(
  userId: string,
): Promise<ReadingAgentStatusLeaseRow | null> {
  const result = await getPool().query<ReadingAgentStatusLeaseRow>(sql`
    SELECT lease.unit_id AS "unitId",
           lease.book_id AS "bookId",
           lease.expires_at AS "expiresAt",
           unit.chapter_label AS "chapterLabel",
           unit.locator
    FROM readmax.reading_agent_lease AS lease
    JOIN readmax.reading_ingest_unit AS unit ON unit.id = lease.unit_id
    WHERE lease.user_id = ${userId}
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function getLiveReadingAgentLease(
  userId: string,
): Promise<ReadingAgentStatusLeaseRow | null> {
  const result = await getPool().query<ReadingAgentStatusLeaseRow>(sql`
    SELECT lease.unit_id AS "unitId",
           lease.book_id AS "bookId",
           lease.expires_at AS "expiresAt",
           unit.chapter_label AS "chapterLabel",
           unit.locator
    FROM readmax.reading_agent_lease AS lease
    JOIN readmax.reading_ingest_unit AS unit ON unit.id = lease.unit_id
    WHERE lease.user_id = ${userId}
      AND lease.expires_at > NOW()
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function listRecentReadingIngestUnits(data: {
  userId: string;
  bookId?: string;
}): Promise<ReadingAgentStatusUnitRow[]> {
  const bookId = data.bookId ?? null;
  const result = await getPool().query<ReadingAgentStatusUnitRow>(sql`
    SELECT id AS "unitId",
           book_id AS "bookId",
           chapter_label AS "chapterLabel",
           locator,
           unit_kind AS "unitKind",
           status,
           attempt_count AS "attemptCount",
           next_attempt_at AS "nextAttemptAt",
           claimed_at AS "claimedAt",
           last_seen_at AS "lastSeenAt",
           error AS "lastError"
    FROM readmax.reading_ingest_unit
    WHERE user_id = ${data.userId}
      AND (${bookId}::text IS NULL OR book_id = ${bookId})
    ORDER BY last_seen_at DESC, id DESC
    LIMIT 50
  `);
  return result.rows;
}

export async function getLatestReadingAgentUsage(
  userId: string,
): Promise<ReadingAgentUsageRow | null> {
  const result = await getPool().query<ReadingAgentUsageRow>(sql`
    SELECT usage.id,
           usage.unit_id AS "unitId",
           usage.input,
           usage.output,
           usage.cache_read AS "cacheRead",
           usage.cache_write AS "cacheWrite",
           usage.total_tokens AS "totalTokens",
           usage.cost_total AS "costTotal",
           usage.model,
           usage.source,
           usage.created_at AS "createdAt"
    FROM readmax.reading_agent_usage AS usage
    JOIN readmax.reading_ingest_unit AS unit ON unit.id = usage.unit_id
    WHERE unit.user_id = ${userId}
    ORDER BY usage.created_at DESC, usage.id DESC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function claimReadingIngestUnitWithLease(
  id: string,
): Promise<ReadingIngestUnitLease | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const candidate = await client.query<{ userId: string }>(sql`
      SELECT user_id AS "userId"
      FROM readmax.reading_ingest_unit
      WHERE id = ${id}
      FOR UPDATE
    `);
    const userId = candidate.rows[0]?.userId;
    if (!userId) {
      await client.query("COMMIT");
      return null;
    }

    await reclaimExpiredReadingAgentWork(client, userId);
    const result = await client.query<ReadingIngestUnitRow & { leaseExpiresAt: Date }>(sql`
      WITH lease AS (
        INSERT INTO readmax.reading_agent_lease (user_id, unit_id, book_id, expires_at)
        SELECT user_id, id, book_id,
               NOW() + (${READING_AGENT_LEASE_TTL_MS} * INTERVAL '1 millisecond')
        FROM readmax.reading_ingest_unit
        WHERE id = ${id}
          AND status IN ('pending', 'error')
          AND attempt_count < 8
          AND next_attempt_at <= NOW()
        ON CONFLICT DO NOTHING
        RETURNING unit_id, expires_at
      )
      UPDATE readmax.reading_ingest_unit AS unit
      SET status = 'processing', claimed_at = NOW(), error = NULL
      FROM lease
      WHERE unit.id = lease.unit_id
      RETURNING ${INGEST_UNIT_COLUMNS}, lease.expires_at AS "leaseExpiresAt"
    `);
    await client.query("COMMIT");
    const claimed = result.rows[0];
    if (!claimed) return null;
    const { leaseExpiresAt, ...unit } = claimed;
    return {
      unit,
      lease: {
        userId: unit.userId,
        unitId: unit.id,
        bookId: unit.bookId,
        expiresAt: leaseExpiresAt,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

export async function releaseReadingIngestUnit(
  claim: ReadingIngestUnitLease,
  error: string,
  usage?: ReadingAgentUsage,
): Promise<void> {
  const attempt = claim.unit.attemptCount + 1;
  const status: ReadingIngestStatus = attempt >= READING_AGENT_MAX_ATTEMPTS ? "error" : "pending";
  const retryDelaySeconds = readingAgentRetryDelaySeconds(attempt);
  const recordedUsage = usage ?? {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
    model: null,
    source: "unknown",
  };
  await getPool().query(sql`
    WITH released AS (
      UPDATE readmax.reading_ingest_unit
      SET status = ${status},
          attempt_count = attempt_count + 1,
          claimed_at = NULL,
          next_attempt_at = NOW() + (${retryDelaySeconds} * INTERVAL '1 second'),
          processed_at = NULL,
          error = ${error}
      WHERE id = ${claim.unit.id}
        AND status = 'processing'
        AND EXISTS (
          SELECT 1
          FROM readmax.reading_agent_lease
          WHERE user_id = ${claim.lease.userId}
            AND unit_id = ${claim.lease.unitId}
            AND expires_at = ${claim.lease.expiresAt.toISOString()}
            AND expires_at > NOW()
        )
      RETURNING id
    ), recorded AS (
      INSERT INTO readmax.reading_agent_usage (
        unit_id, input, output, cache_read, cache_write, total_tokens, cost_total, model, source
      )
      SELECT ${claim.unit.id}, ${recordedUsage.input}, ${recordedUsage.output},
             ${recordedUsage.cacheRead}, ${recordedUsage.cacheWrite},
             ${recordedUsage.totalTokens}, ${recordedUsage.costTotal},
             ${recordedUsage.model ?? null}, ${recordedUsage.source}
      WHERE ${usage !== undefined}
      RETURNING unit_id
    )
    DELETE FROM readmax.reading_agent_lease
    WHERE unit_id IN (SELECT id FROM released)
      AND expires_at = ${claim.lease.expiresAt.toISOString()}
  `);
}

export async function getNextDueReadingIngestUnit(
  userId: string,
): Promise<ReadingIngestUnitRow | null> {
  const result = await getPool().query<ReadingIngestUnitRow>(sql`
    SELECT ${INGEST_UNIT_COLUMNS}
    FROM readmax.reading_ingest_unit
    WHERE user_id = ${userId}
      AND status IN ('pending', 'error')
      AND attempt_count < 8
      AND next_attempt_at <= NOW()
      AND NOT EXISTS (
        SELECT 1
        FROM readmax.reading_agent_lease
        WHERE user_id = ${userId}
          AND expires_at > NOW()
      )
    ORDER BY next_attempt_at ASC, first_seen_at ASC, id ASC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function listReadingIngestSweepUserIds(): Promise<string[]> {
  const result = await getPool().query<{ userId: string }>(sql`
    SELECT DISTINCT candidate.user_id AS "userId"
    FROM (
      SELECT user_id
      FROM readmax.reading_ingest_unit
      WHERE status IN ('pending', 'error')
        AND attempt_count < 8
        AND next_attempt_at <= NOW()
      UNION
      SELECT user_id
      FROM readmax.reading_ingest_unit
      WHERE status = 'processing'
        AND claimed_at <= NOW() - (${READING_AGENT_LEASE_TTL_MS} * INTERVAL '1 millisecond')
      UNION
      SELECT user_id
      FROM readmax.reading_agent_lease
      WHERE expires_at <= NOW()
    ) AS candidate
    WHERE NOT EXISTS (
      SELECT 1
      FROM readmax.reading_agent_lease AS live_lease
      WHERE live_lease.user_id = candidate.user_id
        AND live_lease.expires_at > NOW()
    )
    ORDER BY candidate.user_id
  `);
  return result.rows.map((row) => row.userId);
}

export async function acquireReadingAgentLease(
  unitId: string,
  expiresAt: Date,
): Promise<ReadingAgentLeaseRow | null> {
  const result = await getPool().query<ReadingAgentLeaseRow>(sql`
    INSERT INTO readmax.reading_agent_lease (user_id, unit_id, book_id, expires_at)
    SELECT user_id, id, book_id, ${expiresAt.toISOString()}
    FROM readmax.reading_ingest_unit
    WHERE id = ${unitId}
    ON CONFLICT DO NOTHING
    RETURNING ${LEASE_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function releaseReadingAgentLease(userId: string, unitId: string): Promise<boolean> {
  const result = await getPool().query(sql`
    DELETE FROM readmax.reading_agent_lease
    WHERE user_id = ${userId}
      AND unit_id = ${unitId}
  `);
  return (result.rowCount ?? 0) > 0;
}

export async function reclaimExpiredReadingAgentLease(userId: string): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const reclaimed = await reclaimExpiredReadingAgentWork(client, userId);
    await client.query("COMMIT");
    return reclaimed;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

async function reclaimExpiredReadingAgentWork(client: PoolClient, userId: string): Promise<number> {
  const expired = await client.query<{ unitId: string }>(sql`
    DELETE FROM readmax.reading_agent_lease
    WHERE user_id = ${userId}
      AND expires_at <= NOW()
    RETURNING unit_id AS "unitId"
  `);
  const expiredUnitIds = expired.rows.map((row) => row.unitId);
  const reclaimed = await client.query<{ id: string }>(sql`
    UPDATE readmax.reading_ingest_unit AS unit
    SET status = CASE WHEN attempt_count + 1 >= 8 THEN 'error' ELSE 'pending' END,
        attempt_count = attempt_count + 1,
        claimed_at = NULL,
        next_attempt_at = NOW() + (
          LEAST(300, 10 * POWER(2, attempt_count)) * INTERVAL '1 second'
        ),
        processed_at = NULL,
        error = 'Reading agent lease expired'
    WHERE user_id = ${userId}
      AND status = 'processing'
      AND (
        id = ANY(${expiredUnitIds}::uuid[])
        OR (
          claimed_at <= NOW() - (${READING_AGENT_LEASE_TTL_MS} * INTERVAL '1 millisecond')
          AND NOT EXISTS (
            SELECT 1
            FROM readmax.reading_agent_lease AS lease
            WHERE lease.unit_id = unit.id
              AND lease.expires_at > NOW()
          )
        )
      )
    RETURNING id
  `);
  return reclaimed.rows.length;
}

export async function insertReadingAgentUsage(
  data: ReadingAgentUsage & { unitId: string },
): Promise<ReadingAgentUsageRow | null> {
  const result = await getPool().query<ReadingAgentUsageRow>(sql`
    INSERT INTO readmax.reading_agent_usage (
      unit_id, input, output, cache_read, cache_write, total_tokens, cost_total, model, source
    )
    VALUES (
      ${data.unitId}, ${data.input}, ${data.output}, ${data.cacheRead}, ${data.cacheWrite},
      ${data.totalTokens}, ${data.costTotal}, ${data.model ?? null}, ${data.source}
    )
    RETURNING ${USAGE_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

async function persistArtifactUpdate(
  client: PoolClient,
  unit: ReadingIngestUnitRow,
  update: ReadingArtifactUpdate,
): Promise<boolean> {
  const current = await client.query<Pick<ReadingArtifactRow, "content" | "revisionId">>(sql`
    SELECT content, revision_id AS "revisionId"
    FROM readmax.reading_artifact
    WHERE user_id = ${unit.userId}
      AND book_id = ${unit.bookId}
      AND kind = ${update.kind}
    FOR UPDATE
  `);
  const head = current.rows[0];
  if (head?.content === update.content) return false;

  const revision = await client.query<{ id: string }>(sql`
    INSERT INTO readmax.reading_artifact_revision (
      user_id, book_id, kind, content, previous_revision_id, actor,
      source_unit_id, source_fingerprint, summary
    )
    VALUES (
      ${unit.userId}, ${unit.bookId}, ${update.kind}, ${update.content},
      ${head?.revisionId ?? null}, 'agent', ${unit.id}, ${unit.fingerprint}, ${update.summary}
    )
    RETURNING id
  `);
  const revisionId = revision.rows[0]?.id;
  if (!revisionId) throw new Error(`Failed to create ${update.kind} artifact revision`);

  await client.query(sql`
    INSERT INTO readmax.reading_artifact (user_id, book_id, kind, content, revision_id)
    VALUES (${unit.userId}, ${unit.bookId}, ${update.kind}, ${update.content}, ${revisionId})
    ON CONFLICT (user_id, book_id, kind) DO UPDATE
      SET content = EXCLUDED.content,
          revision_id = EXCLUDED.revision_id,
          updated_at = NOW()
  `);
  return true;
}

async function recordReadingAgentUsage(
  client: PoolClient,
  unitId: string,
  usage: ReadingAgentUsage,
): Promise<void> {
  await client.query(sql`
    INSERT INTO readmax.reading_agent_usage (
      unit_id, input, output, cache_read, cache_write, total_tokens, cost_total, model, source
    )
    VALUES (
      ${unitId}, ${usage.input}, ${usage.output}, ${usage.cacheRead}, ${usage.cacheWrite},
      ${usage.totalTokens}, ${usage.costTotal}, ${usage.model ?? null}, ${usage.source}
    )
  `);
}

export async function completeReadingIngestUnit(
  claim: ReadingIngestUnitLease,
  updates: readonly ReadingArtifactUpdate[],
  usage: ReadingAgentUsage,
): Promise<number | null> {
  const { unit, lease } = claim;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ id: string }>(sql`
      SELECT id
      FROM readmax.reading_ingest_unit
      WHERE id = ${unit.id}
        AND user_id = ${unit.userId}
        AND book_id = ${unit.bookId}
        AND fingerprint = ${unit.fingerprint}
        AND status = 'processing'
        AND EXISTS (
          SELECT 1
          FROM readmax.reading_agent_lease
          WHERE user_id = ${lease.userId}
            AND unit_id = ${lease.unitId}
            AND expires_at = ${lease.expiresAt.toISOString()}
            AND expires_at > NOW()
        )
      FOR UPDATE
    `);
    if (!locked.rows[0]) {
      await recordReadingAgentUsage(client, unit.id, usage);
      await client.query("COMMIT");
      return null;
    }

    let revisionCount = 0;
    for (const update of updates) {
      if (await persistArtifactUpdate(client, unit, update)) revisionCount += 1;
    }

    await recordReadingAgentUsage(client, unit.id, usage);

    await client.query(sql`
      UPDATE readmax.reading_ingest_unit
      SET status = 'done', claimed_at = NULL, processed_at = NOW(), error = NULL
      WHERE id = ${unit.id}
    `);
    await client.query(sql`
      DELETE FROM readmax.reading_agent_lease
      WHERE user_id = ${lease.userId}
        AND unit_id = ${lease.unitId}
        AND expires_at = ${lease.expiresAt.toISOString()}
    `);
    await client.query("COMMIT");
    return revisionCount;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertReadingArtifactRevision(data: {
  userId: string;
  bookId: string;
  kind: ReadingArtifactKind;
  content: string;
  previousRevisionId?: string | null;
  actor: ReadingArtifactActor;
  sourceUnitId: string;
  sourceFingerprint: string;
  summary: string;
}): Promise<ReadingArtifactRevisionRow | null> {
  const result = await getPool().query<ReadingArtifactRevisionRow>(sql`
    INSERT INTO readmax.reading_artifact_revision (
      user_id, book_id, kind, content, previous_revision_id, actor,
      source_unit_id, source_fingerprint, summary
    )
    VALUES (
      ${data.userId},
      ${data.bookId},
      ${data.kind},
      ${data.content},
      ${data.previousRevisionId ?? null},
      ${data.actor},
      ${data.sourceUnitId},
      ${data.sourceFingerprint},
      ${data.summary}
    )
    RETURNING ${REVISION_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function upsertCurrentReadingArtifact(data: {
  userId: string;
  bookId: string;
  kind: ReadingArtifactKind;
  content: string;
  revisionId: string;
}): Promise<ReadingArtifactRow | null> {
  const result = await getPool().query<ReadingArtifactRow>(sql`
    INSERT INTO readmax.reading_artifact (user_id, book_id, kind, content, revision_id)
    VALUES (${data.userId}, ${data.bookId}, ${data.kind}, ${data.content}, ${data.revisionId})
    ON CONFLICT (user_id, book_id, kind) DO UPDATE
      SET content = EXCLUDED.content,
          revision_id = EXCLUDED.revision_id,
          updated_at = NOW()
    RETURNING ${ARTIFACT_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function getCurrentReadingArtifacts(
  userId: string,
  bookId: string,
): Promise<ReadingArtifactRow[]> {
  const result = await getPool().query<ReadingArtifactRow>(sql`
    SELECT ${ARTIFACT_COLUMNS}
    FROM readmax.reading_artifact
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
    ORDER BY kind ASC
  `);
  return result.rows;
}

export async function listReadingArtifactRevisions(data: {
  userId: string;
  bookId: string;
  kind: ReadingArtifactKind;
}): Promise<ReadingArtifactRevisionRow[]> {
  const result = await getPool().query<ReadingArtifactRevisionRow>(sql`
    SELECT ${REVISION_COLUMNS}
    FROM readmax.reading_artifact_revision
    WHERE user_id = ${data.userId}
      AND book_id = ${data.bookId}
      AND kind = ${data.kind}
    ORDER BY created_at DESC, id DESC
  `);
  return result.rows;
}
