import { sql } from "pg-sql";
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
  processedAt: Date | null;
  error: string | null;
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
  processed_at AS "processedAt",
  error
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
