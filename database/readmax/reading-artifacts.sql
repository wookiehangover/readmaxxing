SET search_path TO readmax;

CREATE TABLE readmax.reading_ingest_unit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    unit_kind TEXT NOT NULL CHECK (unit_kind IN ('epub-spine', 'pdf-page')),
    locator TEXT NOT NULL,
    chapter_label TEXT,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'skipped', 'error')),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    claimed_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE (user_id, book_id, fingerprint)
);

CREATE INDEX reading_ingest_unit_status_idx
    ON readmax.reading_ingest_unit (status, first_seen_at);

CREATE INDEX reading_ingest_unit_due_idx
    ON readmax.reading_ingest_unit (user_id, next_attempt_at, first_seen_at)
    WHERE status IN ('pending', 'error');

CREATE TABLE readmax.reading_agent_lease (
    user_id UUID PRIMARY KEY REFERENCES readmax.user(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL UNIQUE REFERENCES readmax.reading_ingest_unit(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX reading_agent_lease_expires_idx
    ON readmax.reading_agent_lease (expires_at);

CREATE TABLE readmax.reading_agent_usage (
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

CREATE INDEX reading_agent_usage_unit_idx
    ON readmax.reading_agent_usage (unit_id, created_at DESC);

CREATE TABLE readmax.reading_artifact_revision (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('outline', 'characters', 'wiki')),
    content TEXT NOT NULL,
    previous_revision_id UUID REFERENCES readmax.reading_artifact_revision(id),
    actor TEXT NOT NULL CHECK (actor IN ('agent', 'user')),
    source_unit_id UUID NOT NULL REFERENCES readmax.reading_ingest_unit(id),
    source_fingerprint TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX reading_artifact_revision_history_idx
    ON readmax.reading_artifact_revision (user_id, book_id, kind, created_at DESC);

CREATE TABLE readmax.reading_artifact (
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('outline', 'characters', 'wiki')),
    content TEXT NOT NULL,
    revision_id UUID NOT NULL REFERENCES readmax.reading_artifact_revision(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id, kind)
);