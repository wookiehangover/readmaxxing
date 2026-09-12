BEGIN;

-- Rollout requires a write pause and drained old handlers before enabling the
-- new server. Legacy writers do not maintain mutation_at, so mixed deployments
-- and rollback to a legacy writer are unsafe without separate reconciliation.
-- Original mutation time orders retries independently of server pull visibility.
-- NULL identifies legacy rows; their existing updated_at remains the baseline.
ALTER TABLE readmax.book ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.highlight ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.bookmark ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.chat_session ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.notebook ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.user_settings ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;
ALTER TABLE readmax.reading_position ADD COLUMN IF NOT EXISTS mutation_at TIMESTAMPTZ;

COMMIT;
