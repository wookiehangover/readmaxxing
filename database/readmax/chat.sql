SET search_path TO readmax;

-- Chat sessions

CREATE TABLE readmax.chat_session (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX chat_session_user_id_idx ON readmax.chat_session (user_id);
CREATE INDEX chat_session_book_id_idx ON readmax.chat_session (book_id);

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
