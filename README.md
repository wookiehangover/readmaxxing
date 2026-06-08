# Readmaxxing

## Overview

A local-first ebook reader in the browser. Drag and drop `.epub` files to load them; books, reading positions, highlights, and notebooks live in IndexedDB and work fully offline. Sign in with a passkey to sync across devices and chat with an AI agent that has read access to your library and notebook. Built on React Router v7 + TypeScript on Cloudflare Workers, with R2 for file storage, direct Postgres connections via `pg` over `cloudflare:sockets`, and Cloudflare Agents (Durable Objects) for chat sessions.

## Tech stack

- React Router v7 (framework mode), TypeScript
- Tailwind CSS v4, shadcn/ui (Base UI, not Radix)
- epubjs for parsing and rendering, idb-keyval for IndexedDB
- Effect.ts for service-based DI and typed errors
- Cloudflare Workers (runtime), R2 (private file + cover storage), direct `pg` over `cloudflare:sockets`, Agents / Durable Objects (chat sessions)
- PlanetScale Postgres reached through `DATABASE_URL` in production and dev
- WebAuthn passkeys via `@simplewebauthn/server` and `@simplewebauthn/browser`
- pnpm, oxlint, oxfmt, Vitest, Playwright

## Local development

Prerequisites: Node 20+, pnpm, and a local Postgres instance with a `readmaxxing` database. The app reads `DATABASE_URL` directly in dev and as a Worker secret in production.

```bash
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`. The notable variables:

- `DATABASE_URL` — local Postgres connection string.
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_ORIGIN` — passkey relying-party config (`localhost` and `http://localhost:5173` in dev).
- `PUBLIC_SITE_URL` — canonical public origin. The service worker registers itself against this, and absolute social preview URLs are derived from it.
- `AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY` — required for chat. `ANTHROPIC_BASE_URL` is optional.

Apply the schema:

```bash
psql "$DATABASE_URL" -f database/readmax/core.sql
for f in database/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

Run the dev server:

```bash
pnpm dev          # react-router dev (Vite, fastest inner loop)
pnpm start        # wrangler dev against the built Worker (closer to prod)
```

Tests, lint, types, and formatting:

```bash
pnpm test         # vitest unit tests
pnpm e2e          # playwright end-to-end tests
pnpm lint         # oxlint
pnpm typecheck    # react-router typegen + tsc
pnpm format       # oxfmt app/
```

## Architecture overview

Epub parsing and rendering happen entirely in the browser. epubjs renders each book inside an isolated iframe; typography and theming are injected through `rendition.hooks.content.register()` because the iframe does not inherit parent-page CSS or font links.

The app is local-first for everything except chat. IndexedDB is the source of truth for books, reading positions, highlights, notebooks, and settings; service mutations append to a changelog store that is pushed to the server on an interval and pulled back on demand. Most entities use Last-Write-Wins by `updatedAt`; highlights use set-union with tombstones; chat is the exception — Postgres is authoritative and IDB is only a warm-start cache for the chat panel.

Cloudflare resource topology:

- **Workers** — single Worker entry at `workers/app.ts` serving all routes and API endpoints.
- **Postgres** — PlanetScale Postgres is reached directly from the Worker through `pg` over `cloudflare:sockets`, using the `DATABASE_URL` Worker secret.
- **R2** — `R2_FILES` (bucket `readmax-files`) and `R2_COVERS` (bucket `readmax-covers`). Both are private; reads go through authenticated `/api/sync/files/*` proxy routes.
- **Agents / Durable Objects** — `AGENTS` namespace bound to the `ChatAgent` class. One Durable Object per chat session, holding stream state for SSE resume.

See `AGENTS.md` for the full architecture rules — Effect.ts conventions, sync engine details, chat tool execution model, component structure rules, and gotchas.

## Deployment to Cloudflare

Cloudflare is the only production runtime. There is no Node server.

### Clean deploy

Use this flow for a fresh Cloudflare account when there is no Vercel Blob data to migrate.

1. Log in to Wrangler:

   ```bash
   pnpm exec wrangler login
   ```

2. Provision the private R2 buckets declared in `wrangler.jsonc`:

   ```bash
   pnpm setup:cloudflare
   ```

   The setup script is idempotent. It reads bucket names from `wrangler.jsonc`, creates any missing private R2 buckets, and prints the required `wrangler secret put` commands. It does not configure public R2 access and does not run database migrations.

3. Set the Worker secrets printed by the setup script, including the production Postgres connection string:

   ```bash
   pnpm exec wrangler secret put DATABASE_URL
   pnpm exec wrangler secret put WEBAUTHN_RP_ID
   pnpm exec wrangler secret put WEBAUTHN_RP_ORIGIN
   pnpm exec wrangler secret put AI_GATEWAY_API_KEY
   pnpm exec wrangler secret put ANTHROPIC_API_KEY
   pnpm exec wrangler secret put ANTHROPIC_BASE_URL # optional
   ```

   `DATABASE_URL` should use the production Postgres URL, for example:

   ```text
   postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require
   ```

4. Apply the Postgres schema once from your operator shell:

   ```bash
   psql "$DATABASE_URL" -f database/readmax/core.sql
   for f in database/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```

5. Update `PUBLIC_SITE_URL` in `wrangler.jsonc` to the deployed origin.

6. Validate the Worker package and deploy:

   ```bash
   pnpm build
   pnpm exec wrangler deploy --dry-run
   pnpm exec wrangler deploy
   ```

### Migrating from Vercel Blob

Only use this checklist when migrating data from an older Vercel + Vercel Blob deployment. For clean deploys, skip this section.

1. Provision Cloudflare resources as described in [Clean deploy](#clean-deploy).
2. Set Worker secrets and update non-secret vars in `wrangler.jsonc`.
3. Dry-run the one-shot backfill that copies legacy Vercel Blob objects into R2 and rewrites book file and cover URLs to `r2://...` references:

   ```bash
   pnpm exec tsx scripts/backfill-blob-to-r2.ts --dry-run --audit-csv migration.csv
   ```

4. Run the backfill for real:

   ```bash
   pnpm exec tsx scripts/backfill-blob-to-r2.ts --audit-csv migration.csv
   ```

   See [Migration script reference](#migration-script-reference) for all available flags.

5. Confirm no legacy storage URLs remain in production:

   ```sql
   SELECT count(*)
   FROM readmax.book
   WHERE file_url ILIKE '%blob.vercel-storage.com%'
      OR cover_url ILIKE '%blob.vercel-storage.com%';
   ```

   The count must be `0` before proceeding.

6. Validate and deploy:

   ```bash
   pnpm build
   pnpm exec wrangler deploy --dry-run
   pnpm exec wrangler deploy
   ```

7. Cut DNS over to the Worker route once health checks pass.

## Migration script reference

`scripts/backfill-blob-to-r2.ts` is a one-shot Node script intended to be run from a developer machine with network access to both Vercel Blob and Cloudflare R2. It reads `BLOB_READ_WRITE_TOKEN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_FILES_BUCKET`, and `R2_COVERS_BUCKET` from the environment (or `.env.local`), with CLI overrides for each.

| Flag                          | Purpose                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `--dry-run`                   | Print the migration plan without downloads, R2 writes, or DB updates.              |
| `--resume-from <bookId>`      | Start from this book id in id-sorted order. Use after a partial failure.           |
| `--concurrency <n>`           | Books processed in parallel (default `5`).                                         |
| `--audit-csv <path>`          | Append `bookId,oldUrl,newKey,bytes,sha256,migratedAtISO` rows for every migration. |
| `--database-url <url>`        | Override `DATABASE_URL`.                                                           |
| `--blob-read-write-token <t>` | Override `BLOB_READ_WRITE_TOKEN`.                                                  |
| `--r2-account-id <id>`        | Override `R2_ACCOUNT_ID`.                                                          |
| `--r2-access-key-id <id>`     | Override `R2_ACCESS_KEY_ID`.                                                       |
| `--r2-secret-access-key <s>`  | Override `R2_SECRET_ACCESS_KEY`.                                                   |
| `--r2-files-bucket <name>`    | Override `R2_FILES_BUCKET`.                                                        |
| `--r2-covers-bucket <name>`   | Override `R2_COVERS_BUCKET`.                                                       |

Typical run:

```bash
pnpm exec tsx scripts/backfill-blob-to-r2.ts \
  --audit-csv migration.csv \
  --concurrency 8 \
  --resume-from 01HZ...   # only when resuming after a failure
```

## Project structure

```
app/         React Router v7 app: routes, components, hooks, Effect services, lib
workers/     Cloudflare Worker entry (app.ts) and ChatAgent Durable Object
scripts/     Operational scripts (setup-cloudflare.sh, backfill-blob-to-r2.ts)
database/    readmax schema (readmax/core.sql) and sequential SQL migrations/
e2e/         Playwright tests and fixture epubs
public/      Static assets, icons, self-hosted Geist fonts
```

## Pointers

- `AGENTS.md` — architecture conventions, Effect.ts patterns, sync engine details, chat runtime, component rules.
- `database/migrations/` — sequential SQL migrations; apply in filename order.
- `wrangler.jsonc` — Worker bindings, vars, R2 buckets, Durable Object class migrations.
