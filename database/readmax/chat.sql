SET search_path TO readmax;

-- Chat sessions

CREATE TABLE readmax.chat_session (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT,
    title TEXT,
    active_stream_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX chat_session_user_id_idx ON readmax.chat_session (user_id);
CREATE INDEX chat_session_book_id_idx ON readmax.chat_session (book_id);
CREATE INDEX chat_session_user_updated_idx ON readmax.chat_session (user_id, updated_at, id);
CREATE INDEX chat_session_user_book_updated_idx ON readmax.chat_session (user_id, book_id, updated_at DESC, id)
    WHERE deleted_at IS NULL;

-- Chat messages

CREATE TABLE readmax.chat_message (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES readmax.chat_session(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    parts JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_message_session_id_idx ON readmax.chat_message (session_id);
CREATE INDEX chat_message_session_created_idx ON readmax.chat_message (session_id, created_at, id);
CREATE INDEX chat_message_created_session_idx ON readmax.chat_message (created_at, session_id, id);
CREATE INDEX chat_message_created_id_session_idx ON readmax.chat_message (created_at, id, session_id);
