-- Add magic-link storage for already-provisioned databases.

BEGIN;

CREATE TABLE IF NOT EXISTS readmax.magic_link (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS magic_link_token_hash_idx ON readmax.magic_link (token_hash);
CREATE INDEX IF NOT EXISTS magic_link_user_id_idx ON readmax.magic_link (user_id);

COMMIT;
