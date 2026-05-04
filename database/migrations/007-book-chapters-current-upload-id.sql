BEGIN;

ALTER TABLE readmax.book_chapters
  ADD COLUMN IF NOT EXISTS current_upload_id TEXT;

COMMIT;