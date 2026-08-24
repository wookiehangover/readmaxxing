# Ebook Reader

A browser-based ebook and PDF reader. Drag and drop `.epub` or `.pdf` files (or import from the Standard Ebooks catalog), browse with `LibraryFrame`, read with `ReadingShell`, and keep books, positions, highlights, and notebooks offline in IndexedDB. Optionally sign in with a passkey to sync across devices and use AI chat.

## Features

- **Drag-and-drop loading** — drop `.epub` or `.pdf` files anywhere on the page
- **Local-first storage** — books, positions, highlights, notebooks, and settings in IndexedDB
- **Reading and library shells** — `ReadingShell` pairs the reader with Notes, Discuss, and Outline; `LibraryFrame` hosts browsing and imports
- **Reading layouts** — single page, two-page spread, or continuous scroll
- **Typography controls** — font family, size, line height, and dark/sepia themes
- **Reading progress** — publisher page numbers when available, otherwise character-based locations
- **Position memory** — resumes where you left off per book (CFI for EPUB, page for PDF)
- **Highlights and notes** — text selection highlights and per-book TipTap notebooks
- **AI chat** — book-aware chat with tools (search, chapters, notes); requires passkey session
- **Standard Ebooks** — browse and import from the catalog
- **Share links** — read-only public shares of a book, position, notebook, and chats
- **Cross-device sync** — passkey sign-in syncs library data; binaries via Vercel Blob
- **Passkey authentication** — passwordless WebAuthn (self-hosted)

## Tech stack

- [React Router v7](https://reactrouter.com/) (framework mode)
- [TypeScript](https://typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) (Base UI)
- [`@readmaxxing/epub-successor`](./packages/epub-successor/) — vendored EPUB 2/3 parsing and rendering
- [pdfjs-dist](https://mozilla.github.io/pdf.js/) — PDF rendering
- [TipTap](https://tiptap.dev/) — notebooks
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) — IndexedDB storage
- [Effect.ts](https://effect.website/) — typed services and errors
- [pg](https://github.com/brianc/node-postgres) + [pg-sql](https://github.com/calebmer/pg-sql) — Postgres
- [@simplewebauthn/server](https://simplewebauthn.dev/) + [@simplewebauthn/browser](https://simplewebauthn.dev/) — WebAuthn
- [@vercel/blob](https://vercel.com/docs/storage/vercel-blob) — cloud file storage

## Monorepo

This repository is a pnpm workspace (`pnpm-workspace.yaml`).

| Path                                                    | Package                       | Role                        |
| ------------------------------------------------------- | ----------------------------- | --------------------------- |
| app root                                                | `repo`                        | React Router web app        |
| [`packages/epub-successor`](./packages/epub-successor/) | `@readmaxxing/epub-successor` | EPUB engine used by the app |

The EPUB package is private (`workspace:*`). See its [README](./packages/epub-successor/README.md) for API usage, security model, and package-level scripts (`demo`, `e2e`, fixtures).

## Getting started

```bash
cp .env.example .env.local  # fill in values for sync / chat features
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) and drop an `.epub` or `.pdf` file to get started.

### Reading artifacts agent

ReadingScribe is hosted by the web app: `pnpm dev` runs it in-process locally, and production
launches it in a Vercel Sandbox. Leave the legacy `READING_AGENT_URL` unset; do not start a
separate `:5174` sidecar. A 60s local sweep reclaims expired leases and retries due units so
local ingest does not wait for the Vercel cron.

The app works fully offline without environment variables. Sync requires Postgres and WebAuthn configuration. Development stores books and covers in `data/blob/` without a Vercel Blob token or callback URL; production uses Vercel Blob. Production chat resume additionally requires Redis — see [Environment variables](#environment-variables).

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

All environment variables are optional for offline reading. Sync and related features require:

- `DATABASE_URL` — Postgres connection string
- `WEBAUTHN_RP_ID` — WebAuthn Relying Party ID (e.g. `localhost` for dev, your domain for prod)
- `WEBAUTHN_RP_ORIGIN` — WebAuthn origin URL (e.g. `http://localhost:5173` for dev)
- `BLOB_STORAGE_BACKEND` — optional `local` or `vercel` override; defaults to local filesystem storage in development and Vercel Blob elsewhere.
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage token, required only when using the Vercel backend.
- `REDIS_URL` — Redis for resumable AI chat streaming (Vercel KV, Upstash, or any Redis-compatible service). Required in production; in development the chat panel works without it but mid-stream reconnect is disabled.
- `READING_AGENT_SECRET` — authenticates the app-hosted ReadingScribe agent.
- `READING_AGENT_URL` — unused legacy external-host override; leave unset.

## Database setup

The app uses a `readmax` Postgres schema. Apply the schema files in order:

```bash
psql $DATABASE_URL -f database/readmax/core.sql
```

Migrations are in `database/migrations/` — apply them sequentially.

## Scripts

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `pnpm run dev`       | Start development server                |
| `pnpm run build`     | Production build                        |
| `pnpm run start`     | Serve production build                  |
| `pnpm run typecheck` | React Router typegen + TypeScript check |
| `pnpm run lint`      | Lint with oxlint                        |
| `pnpm run format`    | Format with oxfmt (`app/`)              |
| `pnpm run test`      | Unit tests (Vitest)                     |
| `pnpm run e2e`       | Playwright end-to-end tests             |

Package-scoped commands (from repo root):

```bash
pnpm --filter @readmaxxing/epub-successor demo
pnpm --filter @readmaxxing/epub-successor e2e
pnpm vitest run packages/epub-successor
```

## Documentation

| Doc                                                                      | Contents                                |
| ------------------------------------------------------------------------ | --------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                           | Workspace, storage, sync, chat, sharing |
| [docs/effect-conventions.md](./docs/effect-conventions.md)               | Effect.ts services and errors           |
| [packages/epub-successor/README.md](./packages/epub-successor/README.md) | EPUB engine API, security, scripts      |
| [AGENTS.md](./AGENTS.md)                                                 | Agent/developer conventions             |

## Troubleshooting sync

Verbose sync diagnostics are opt-in. In DevTools, run `localStorage.setItem("sync_debug", "1")` and reload to see structured `[sync-debug]` logs for upload attempts, push/pull cycles, and retry backoffs. Clear the flag with `localStorage.removeItem("sync_debug")`.

## License

MIT
