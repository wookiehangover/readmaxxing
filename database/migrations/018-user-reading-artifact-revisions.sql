-- Allow user-authored artifact revisions without creating ingest units.

BEGIN;

ALTER TABLE readmax.reading_artifact_revision
    ALTER COLUMN source_unit_id DROP NOT NULL,
    ALTER COLUMN source_fingerprint DROP NOT NULL;

COMMIT;