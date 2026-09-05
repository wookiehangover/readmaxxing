-- Additive review storage. Safe to run on existing databases; no backfill or drops.
BEGIN;

-- Shared questions have no user/book association and contain no private answers.
CREATE TABLE IF NOT EXISTS readmax.review_question (
    id TEXT PRIMARY KEY,
    source_fingerprint TEXT NOT NULL CHECK (source_fingerprint ~ '^review-text-v1:[a-f0-9]{64}$'),
    difficulty TEXT NOT NULL CHECK (difficulty IN ('friendly', 'challenging', 'adversarial', 'tyler_cowen')),
    generation_version TEXT NOT NULL CHECK (length(generation_version) > 0),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    prompt_version INTEGER NOT NULL CHECK (prompt_version > 0),
    question TEXT NOT NULL CHECK (length(btrim(question)) > 0),
    rubric JSONB NOT NULL CHECK (jsonb_typeof(rubric) = 'object'),
    provenance JSONB NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (source_fingerprint, difficulty, generation_version),
    UNIQUE (id, source_fingerprint)
);

-- A durable checkpoint assignment. Pass/latest are derived from immutable attempts.
-- Preferences and editable drafts remain local, scoped by account + book + chapter.
CREATE TABLE IF NOT EXISTS readmax.review_progress (
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL,
    chapter_key TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    question_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, book_id, chapter_key, source_fingerprint),
    UNIQUE (user_id, book_id, chapter_key, source_fingerprint, question_id),
    FOREIGN KEY (user_id, book_id) REFERENCES readmax.book_chapters(user_id, book_id) ON DELETE CASCADE,
    FOREIGN KEY (question_id, source_fingerprint) REFERENCES readmax.review_question(id, source_fingerprint)
);

CREATE TABLE IF NOT EXISTS readmax.review_attempt (
    user_id UUID NOT NULL REFERENCES readmax.user(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_key TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    question_id TEXT NOT NULL,
    document JSONB NOT NULL CHECK (jsonb_typeof(document) = 'object'),
    plain_text TEXT NOT NULL CHECK (length(btrim(plain_text)) > 30),
    grading TEXT NOT NULL CHECK (grading IN ('reading_group', 'community_college', 'elite_professor', 'tyler_cowen')),
    verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail', 'needs_work')),
    feedback TEXT NOT NULL CHECK (length(btrim(feedback)) > 0),
    annotations JSONB NOT NULL CHECK (jsonb_typeof(annotations) = 'array'),
    provenance JSONB NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
    grading_version TEXT NOT NULL CHECK (length(grading_version) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id, book_id, chapter_key, source_fingerprint, question_id)
      REFERENCES readmax.review_progress(user_id, book_id, chapter_key, source_fingerprint, question_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS review_attempt_checkpoint_idx
    ON readmax.review_attempt (user_id, book_id, chapter_key, source_fingerprint, created_at, id);

COMMIT;
