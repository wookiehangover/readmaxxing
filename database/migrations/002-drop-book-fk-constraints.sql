-- Migration: Drop FK constraints referencing readmax.book(id)
-- In a local-first sync system, entities (reading positions, highlights,
-- notebooks, chat sessions) can arrive before the book they reference.
-- Removing these FKs allows data to sync in any order.
-- FK constraints on user_id are kept — the user always exists before sync.

BEGIN;

ALTER TABLE readmax.reading_position
    DROP CONSTRAINT IF EXISTS reading_position_book_id_fkey;

ALTER TABLE readmax.highlight
    DROP CONSTRAINT IF EXISTS highlight_book_id_fkey;

ALTER TABLE readmax.notebook
    DROP CONSTRAINT IF EXISTS notebook_book_id_fkey;

ALTER TABLE readmax.chat_session
    DROP CONSTRAINT IF EXISTS chat_session_book_id_fkey;

COMMIT;
