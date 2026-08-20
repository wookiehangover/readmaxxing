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
    text_anchor JSONB,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX highlight_user_id_idx ON readmax.highlight (user_id);
CREATE INDEX highlight_book_id_idx ON readmax.highlight (book_id);
CREATE INDEX highlight_user_updated_idx ON readmax.highlight (user_id, updated_at, id);
CREATE INDEX highlight_user_deleted_idx ON readmax.highlight (user_id, deleted_at, id)
    WHERE deleted_at IS NOT NULL;

-- Notebooks (per-book user notes, stored as JSONB)

CREATE TABLE readmax.notebook (
    user_id UUID NOT NULL REFERENCES readmax.user(id),
    book_id TEXT NOT NULL,
    content JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id)
);
CREATE INDEX notebook_user_updated_idx ON readmax.notebook (user_id, updated_at, book_id);
