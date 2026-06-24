CREATE SCHEMA IF NOT EXISTS readmax;

SET search_path TO readmax;

-- Users

CREATE TABLE readmax.user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ
);

-- Passkeys (WebAuthn credentials)

CREATE TABLE readmax.passkey (
    id TEXT PRIMARY KEY, -- credential ID
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    public_key BYTEA NOT NULL,
    webauthn_user_id TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type VARCHAR(32),
    backed_up BOOLEAN DEFAULT FALSE,
    transports TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX passkey_user_id_idx ON readmax.passkey (user_id);
CREATE INDEX passkey_webauthn_user_id_idx ON readmax.passkey (webauthn_user_id);

-- Sessions

CREATE TABLE readmax.session (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX session_user_id_idx ON readmax.session (user_id);
CREATE INDEX session_expires_at_idx ON readmax.session (expires_at);

-- Challenges (WebAuthn registration/authentication)

CREATE TABLE readmax.challenge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES readmax.user(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    type VARCHAR(32) NOT NULL CHECK (type IN ('registration', 'authentication')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX challenge_user_id_idx ON readmax.challenge (user_id);
CREATE INDEX challenge_expires_at_idx ON readmax.challenge (expires_at);

-- Books

CREATE TABLE readmax.book (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    title TEXT,
    author TEXT,
    format TEXT,
    cover_blob_url TEXT,
    file_blob_url TEXT,
    file_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX book_user_id_idx ON readmax.book (user_id);
CREATE INDEX book_user_updated_idx ON readmax.book (user_id, updated_at, id);
CREATE INDEX book_user_live_updated_idx ON readmax.book (user_id, updated_at DESC, id)
    WHERE deleted_at IS NULL;

-- Reading positions

CREATE TABLE readmax.reading_position (
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    cfi TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id)
);
CREATE INDEX reading_position_user_updated_idx ON readmax.reading_position (user_id, updated_at, book_id);

-- Cached chapter extraction per book (used by chat / summarization pipelines)

CREATE TABLE readmax.book_chapters (
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    chapters JSONB NOT NULL,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id)
);
