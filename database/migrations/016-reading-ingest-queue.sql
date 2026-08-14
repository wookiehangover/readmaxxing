-- Add durable queue scheduling, per-user leases, and ReadingScribe usage records.

BEGIN;

ALTER TABLE readmax.reading_ingest_unit
    ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS reading_ingest_unit_due_idx
    ON readmax.reading_ingest_unit (user_id, next_attempt_at, first_seen_at)
    WHERE status IN ('pending', 'error');

CREATE TABLE IF NOT EXISTS readmax.reading_agent_lease (
    user_id UUID PRIMARY KEY REFERENCES readmax.user(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL UNIQUE REFERENCES readmax.reading_ingest_unit(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reading_agent_lease_expires_idx
    ON readmax.reading_agent_lease (expires_at);

CREATE TABLE IF NOT EXISTS readmax.reading_agent_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES readmax.reading_ingest_unit(id) ON DELETE CASCADE,
    input BIGINT NOT NULL DEFAULT 0 CHECK (input >= 0),
    output BIGINT NOT NULL DEFAULT 0 CHECK (output >= 0),
    cache_read BIGINT NOT NULL DEFAULT 0 CHECK (cache_read >= 0),
    cache_write BIGINT NOT NULL DEFAULT 0 CHECK (cache_write >= 0),
    total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    cost_total NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
    model TEXT,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reading_agent_usage_unit_idx
    ON readmax.reading_agent_usage (unit_id, created_at DESC);

COMMIT;