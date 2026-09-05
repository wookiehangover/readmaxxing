BEGIN;

-- Apply after 021 while affected writers are paused and old handlers drained.
-- Resume only compatible writers. Preserve this column and its data on rollback;
-- legacy writers can resurrect aliases and are not a supported rollback target.
-- Deliberately no hash-based backfill: ordinary deletions are not dedup aliases.
ALTER TABLE readmax.book ADD COLUMN IF NOT EXISTS canonical_id TEXT;

COMMIT;
