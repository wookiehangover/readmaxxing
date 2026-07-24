-- Add user-managed passkey metadata for already-provisioned databases.

BEGIN;

ALTER TABLE readmax.passkey
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

COMMIT;