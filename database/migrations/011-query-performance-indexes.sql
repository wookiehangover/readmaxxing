-- Migration: indexes for high-volume sync and shared-read query paths.
--
-- Keep this file outside an explicit transaction so Postgres can build
-- indexes concurrently during production migrations.

CREATE INDEX CONCURRENTLY IF NOT EXISTS book_user_updated_idx
  ON readmax.book (user_id, updated_at, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS book_user_live_updated_idx
  ON readmax.book (user_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS reading_position_user_updated_idx
  ON readmax.reading_position (user_id, updated_at, book_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS highlight_user_updated_idx
  ON readmax.highlight (user_id, updated_at, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS highlight_user_deleted_idx
  ON readmax.highlight (user_id, deleted_at, id)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS notebook_user_updated_idx
  ON readmax.notebook (user_id, updated_at, book_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_session_user_updated_idx
  ON readmax.chat_session (user_id, updated_at, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_session_user_book_updated_idx
  ON readmax.chat_session (user_id, book_id, updated_at DESC, id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_message_session_created_idx
  ON readmax.chat_message (session_id, created_at, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_message_created_session_idx
  ON readmax.chat_message (created_at, session_id, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_message_created_id_session_idx
  ON readmax.chat_message (created_at, id, session_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS bookmark_user_updated_id_idx
  ON readmax.bookmark (user_id, updated_at, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS bookmark_user_deleted_idx
  ON readmax.bookmark (user_id, deleted_at, id)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS share_link_user_book_created_idx
  ON readmax.share_link (user_id, book_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS session_expires_at_idx
  ON readmax.session (expires_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS challenge_expires_at_idx
  ON readmax.challenge (expires_at);
