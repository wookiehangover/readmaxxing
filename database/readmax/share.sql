SET search_path TO readmax;

-- Share links

CREATE TABLE readmax.share_link (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    max_uses INT,
    use_count INT NOT NULL DEFAULT 0,
    share_chats BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX share_link_user_book_idx ON readmax.share_link (user_id, book_id);
CREATE INDEX share_link_user_book_created_idx ON readmax.share_link (user_id, book_id, created_at DESC);
