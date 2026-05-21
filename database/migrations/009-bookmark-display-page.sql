BEGIN;
ALTER TABLE readmax.bookmark
  ADD COLUMN IF NOT EXISTS display_page INT;
COMMIT;