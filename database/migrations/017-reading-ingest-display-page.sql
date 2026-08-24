BEGIN;

ALTER TABLE readmax.reading_ingest_unit
  ADD COLUMN IF NOT EXISTS display_page INTEGER CHECK (display_page > 0);

COMMIT;