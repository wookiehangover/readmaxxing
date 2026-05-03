# Ebook Reader

A browser-based ebook reader. Drag and drop `.epub` or `.pdf` files to load them, and read with customizable typography and layout settings. Books are stored locally in IndexedDB — no server or account required. Optionally sign in with a passkey to sync across devices.

## Features

- **Drag-and-drop loading** — drop `.epub` or `.pdf` files anywhere on the page
- **Local persistence** — books and reading positions stored in IndexedDB
- **Inbox-style layout** — book list sidebar with reader pane
- **Dark mode** — system-aware with manual toggle
- **Layout modes** — single page, two-page spread, continuous scroll
- **Typography controls** — font family, size, and line height
- **Reading progress** — chapter and overall progress indicators
- **Position memory** — resumes where you left off per book
- **Cross-device sync** — sign in with a passkey to sync books, reading positions, highlights, notebooks, chat sessions, and settings across devices
- **Passkey authentication** — passwordless login via WebAuthn (self-hosted, no third-party auth service)
- **Cloud storage** — epub files and cover images stored privately in Cloudflare R2

## Tech Stack

- [React Router v7](https://reactrouter.com/) (framework mode)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [epubjs](https://github.com/futurepress/epub.js) — epub parsing and rendering
- [idb-keyval](https://github.com/nickersk/idb-keyval) — IndexedDB storage
- [Effect.ts](https://effect.website/) — typed error handling and service architecture
- [pg](https://github.com/brianc/node-postgres) + [pg-sql](https://github.com/calebmer/pg-sql) — Postgres database access
- [@simplewebauthn/server](https://simplewebauthn.dev/) + [@simplewebauthn/browser](https://simplewebauthn.dev/) — WebAuthn passkey authentication
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — private file and cover storage

## Getting Started

```bash
cp .env.example .env.local  # fill in values for sync features
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) and drop an `.epub` file to get started.

The app works fully offline without any environment variables. Sync features require a Postgres database and private Cloudflare R2 buckets — see [Environment Variables](#environment-variables) below.

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

All environment variables are optional — the app works fully offline without them. Sync features require:

- `DATABASE_URL` — Postgres connection string
- `WEBAUTHN_RP_ID` — WebAuthn Relying Party ID (e.g. `localhost` for dev, your domain for prod)
- `WEBAUTHN_RP_ORIGIN` — WebAuthn origin URL (e.g. `http://localhost:5173` for dev)
- `R2_FILES` / `R2_COVERS` — Cloudflare Worker R2 bucket bindings for private book files and covers
- `BLOB_READ_WRITE_TOKEN` — legacy Vercel Blob token kept temporarily for the Wave 3 backfill from old blob URLs
- `REDIS_URL` — Redis connection string for resumable AI chat streaming (Vercel KV, Upstash, or any Redis-compatible service). Required in production; in development the chat panel works without it but mid-stream reconnect is disabled.

Create the private R2 buckets before deploying the Worker:

```bash
pnpm exec wrangler r2 bucket create readmax-files
pnpm exec wrangler r2 bucket create readmax-covers
```

Do not enable public access for either bucket; uploads and downloads go through authenticated `/api/sync/files/*` routes.

## Database Setup

The app uses a `readmax` Postgres schema. Apply the schema files in order:

```bash
psql $DATABASE_URL -f database/readmax/core.sql
```

Migrations are in `database/migrations/` — apply them sequentially.

## Migrating Vercel Blob to R2

Wave 3 includes a one-shot local migration script that copies legacy Vercel Blob objects referenced by `readmax.book.file_blob_url` and `readmax.book.cover_blob_url` into the private Cloudflare R2 buckets, then rewrites those DB columns to `r2://...` references.

1. Set these environment variables locally, either in `.env.local` or as CLI flag overrides: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_FILES_BUCKET`, and `R2_COVERS_BUCKET`.
2. Run a dry run first:
   ```bash
   pnpm exec tsx scripts/backfill-blob-to-r2.ts --dry-run --audit-csv migration.csv
   ```
3. Inspect `migration.csv` and the stdout plan.
4. Run the migration without `--dry-run`:
   ```bash
   pnpm exec tsx scripts/backfill-blob-to-r2.ts --audit-csv migration.csv
   ```
5. Verify no legacy references remain:
   ```sql
   SELECT count(*)
   FROM readmax.book
   WHERE file_blob_url ILIKE '%blob.vercel-storage.com%'
      OR cover_blob_url ILIKE '%blob.vercel-storage.com%';
   ```
   The count must be `0`.
6. Only after that verification passes, proceed to Wave 4 cleanup.

## Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `pnpm run dev`       | Start development server     |
| `pnpm run build`     | Production build             |
| `pnpm run start`     | Serve production build       |
| `pnpm run typecheck` | Run TypeScript type checking |
| `pnpm run lint`      | Lint with oxlint             |
| `pnpm run format`    | Format with oxfmt            |

## Troubleshooting sync

Verbose sync diagnostics are opt-in. In DevTools, run `localStorage.setItem("sync_debug", "1")` and reload to see structured `[sync-debug]` logs for upload attempts, push/pull cycles, and retry backoffs. Clear the flag with `localStorage.removeItem("sync_debug")`.

## License

MIT
