BEGIN;

ALTER TABLE readmax.reading_ingest_unit
  ADD COLUMN IF NOT EXISTS previous_page TEXT,
  ADD COLUMN IF NOT EXISTS next_page TEXT;

ALTER TABLE readmax.reading_agent_usage
  ADD COLUMN IF NOT EXISTS quality JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
