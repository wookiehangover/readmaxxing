SET search_path TO readmax;

-- Highlights

CREATE TABLE readmax.highlight (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    cfi_range TEXT,
    text TEXT,
    color TEXT,
    page_number INT,
    text_offset INT,
    text_length INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX highlight_user_id_idx ON readmax.highlight (user_id);
CREATE INDEX highlight_book_id_idx ON readmax.highlight (book_id);

-- Notebooks (per-book user notes, stored as JSONB)

CREATE TABLE readmax.notebook (
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    content JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id)
);
