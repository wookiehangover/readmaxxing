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

export async function claimReadingIngestUnit(id: string): Promise<ReadingIngestUnitRow | null> {
  const result = await getPool().query<ReadingIngestUnitRow>(sql`
    UPDATE readmax.reading_ingest_unit
    SET status = 'processing', claimed_at = NOW(), error = NULL
    WHERE id = ${id}
      AND status IN ('pending', 'error')
      AND attempt_count < 8
      AND next_attempt_at <= NOW()
    RETURNING ${INGEST_UNIT_COLUMNS}
  `);
  return result.rows[0] ?? null;
}

export async function releaseReadingIngestUnit(id: string, error: string): Promise<void> {
  await getPool().query(sql`
    UPDATE readmax.reading_ingest_unit
    SET status = 'pending', claimed_at = NULL, processed_at = NULL, error = ${error}
    WHERE id = ${id}
      AND status = 'processing'
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
    ORDER BY next_attempt_at ASC, first_seen_at ASC, id ASC
    LIMIT 1
  `);
  return result.rows[0] ?? null;
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
    const expired = await client.query<{ unitId: string }>(sql`
      DELETE FROM readmax.reading_agent_lease
      WHERE user_id = ${userId}
        AND expires_at <= NOW()
      RETURNING unit_id AS "unitId"
    `);
    const unitIds = expired.rows.map((row) => row.unitId);
    if (unitIds.length > 0) {
      await client.query(sql`
        UPDATE readmax.reading_ingest_unit
        SET status = CASE WHEN attempt_count + 1 >= 8 THEN 'error' ELSE 'pending' END,
            attempt_count = attempt_count + 1,
            claimed_at = NULL,
            next_attempt_at = NOW(),
            processed_at = NULL,
            error = 'Reading agent lease expired'
        WHERE id = ANY(${unitIds}::uuid[])
          AND status = 'processing'
      `);
    }
    await client.query("COMMIT");
    return unitIds.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(console.error);
    throw error;
  } finally {
    client.release();
  }
}

export async function insertReadingAgentUsage(data: {
  unitId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number | string;
  model?: string | null;
  source: string;
}): Promise<ReadingAgentUsageRow | null> {
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

export async function completeReadingIngestUnit(
  unit: ReadingIngestUnitRow,
  updates: readonly ReadingArtifactUpdate[],
): Promise<number> {
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
      FOR UPDATE
    `);
    if (!locked.rows[0]) throw new Error(`Ingest unit ${unit.id} is not processing`);

    let revisionCount = 0;
    for (const update of updates) {
      if (await persistArtifactUpdate(client, unit, update)) revisionCount += 1;
    }

    await client.query(sql`
      UPDATE readmax.reading_ingest_unit
      SET status = 'done', claimed_at = NULL, processed_at = NOW(), error = NULL
      WHERE id = ${unit.id}
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
