-- Add bug report notes for admin triage.
BEGIN;

ALTER TABLE readmax.bug_report
    ADD COLUMN IF NOT EXISTS notes TEXT;

COMMIT;
