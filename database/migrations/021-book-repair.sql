BEGIN;
CREATE TABLE IF NOT EXISTS readmax.book_repair (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES readmax."user"(id) ON DELETE CASCADE,
  book_id text NOT NULL,
  source_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  diagnostics jsonb NOT NULL DEFAULT '[]',
  error text,
  repaired_data bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (octet_length(repaired_data) <= 4194304)
);
CREATE UNIQUE INDEX IF NOT EXISTS book_repair_one_running_per_user
  ON readmax.book_repair(user_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS book_repair_book ON readmax.book_repair(user_id, book_id, created_at DESC);

COMMIT;
