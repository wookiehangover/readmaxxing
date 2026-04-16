-- Add updated_at column to highlight table for incremental sync cursor tracking.
-- Without this, edited highlights (color/text changes) won't be picked up by
-- getHighlightsByUserSince() on incremental pull.

ALTER TABLE readmax.highlight
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill: set updated_at = created_at for existing rows
UPDATE readmax.highlight SET updated_at = created_at WHERE updated_at = NOW();
