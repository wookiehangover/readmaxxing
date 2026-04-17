# Database

All server persistence lives in the `readmax` Postgres schema. Files in this directory are split into two groups:

- `readmax/` — baseline schema (tables created the first time a database is provisioned). Apply these once, in order, on a fresh database.
- `migrations/` — numbered, forward-only SQL patches applied on top of the baseline. Each migration is idempotent (uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) and wrapped in a single transaction, so re-running it against a database that already has the change is a no-op.

## Baseline schema

Apply once when provisioning a new database:

```bash
psql "$DATABASE_URL" -f database/readmax/core.sql
psql "$DATABASE_URL" -f database/readmax/annotations.sql
psql "$DATABASE_URL" -f database/readmax/chat.sql
psql "$DATABASE_URL" -f database/readmax/settings.sql
```

## Migrations

Apply migrations in numeric order. Each migration is a single transaction; if one fails, re-running it is safe.

```bash
for f in database/migrations/*.sql; do
  echo "Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

### Apply order

| #   | File                                           | Summary                                                                                                                               | Notes                               |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 001 | `001-book-id-to-text.sql`                      | Switch `readmax.book.id` from UUID to TEXT so client-generated book ids can be used directly.                                         | Required before 002.                |
| 002 | `002-drop-book-fk-constraints.sql`             | Drop foreign-key constraints from entities that reference `readmax.book(id)` so books can be deleted locally without cascade errors.  | Safe to re-run.                     |
| 003 | `003-highlight-updated-at.sql`                 | Add `updated_at` to `readmax.highlight` for LWW conflict resolution and set-union merge bookkeeping.                                  | Safe to re-run.                     |
| 004 | `004-book-file-hash-unique.sql`                | Add a partial unique index on `readmax.book (user_id, file_hash)` for live rows to dedupe cross-device uploads at the DB level.       | Merged from main.                   |
| 005 | `005-chat-active-stream-and-book-chapters.sql` | Add `chat_session.active_stream_id` for resumable SSE streams. Create `readmax.book_chapters` to cache parsed epub TOC per user/book. | Introduced on the chat-sync branch. |
| 006 | `006-highlight-text-anchor-and-note.sql`       | Add `text_anchor` (JSONB) and `note` (TEXT) columns to `readmax.highlight`. Required by the server-side `create_highlight` AI tool.   | Introduced on the chat-sync branch. |

### Deploy checklist (chat-sync branch → main)

These migrations are new on this feature branch and must be applied before the corresponding server code is deployed:

1. `005-chat-active-stream-and-book-chapters.sql` — must land **before** deploying the new `/api/chat` and `/api/chat/resume/:sessionId` routes; those routes write and read `chat_session.active_stream_id` and the `book_chapters` cache.
2. `006-highlight-text-anchor-and-note.sql` — must land **before** deploying the server-side `create_highlight` AI tool; the tool inserts rows with `text_anchor` and `note` populated.

Migrations 001–003 are already live on `origin/main` and do not need to be re-applied for this deploy.

### Idempotency notes

- Every statement uses `IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`, so re-applying a migration against a database that already has the change is a no-op.
- Migrations are wrapped in `BEGIN ... COMMIT`. If any statement fails, the whole migration rolls back — re-run once the underlying issue is fixed.
- There is no dedicated migration tracking table. Operators are responsible for applying migrations in numeric order; idempotency makes double-applying safe.
