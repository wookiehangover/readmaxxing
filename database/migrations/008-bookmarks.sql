BEGIN;

CREATE TABLE readmax.bookmark (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    cfi TEXT,
    label TEXT,
    page_number INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_bookmark_user_book ON readmax.bookmark(user_id, book_id);
CREATE INDEX idx_bookmark_user_updated ON readmax.bookmark(user_id, updated_at);

COMMIT;