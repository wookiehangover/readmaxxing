-- Add server-authoritative reading ingest units and versioned artifacts.

BEGIN;

CREATE TABLE IF NOT EXISTS readmax.reading_ingest_unit (
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
    processed_at TIMESTAMPTZ,
    error TEXT,
    UNIQUE (user_id, book_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS reading_ingest_unit_status_idx
    ON readmax.reading_ingest_unit (status, first_seen_at);

CREATE TABLE IF NOT EXISTS readmax.reading_artifact_revision (
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

CREATE INDEX IF NOT EXISTS reading_artifact_revision_history_idx
    ON readmax.reading_artifact_revision (user_id, book_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS readmax.reading_artifact (
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('outline', 'characters', 'wiki')),
    content TEXT NOT NULL,
    revision_id UUID NOT NULL REFERENCES readmax.reading_artifact_revision(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id, kind)
);

COMMIT;