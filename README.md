# Ebook Reader

A browser-based ebook reader. Drag and drop `.epub` files to load them, and read with customizable typography and layout settings. Books are stored locally in IndexedDB — no server or account required. Optionally sign in with a passkey to sync across devices.

## Features

- **Drag-and-drop loading** — drop `.epub` files anywhere on the page
- **Local persistence** — books and reading positions stored in IndexedDB
- **Inbox-style layout** — book list sidebar with reader pane
- **Dark mode** — system-aware with manual toggle
- **Layout modes** — single page, two-page spread, continuous scroll
- **Typography controls** — font family, size, and line height
- **Reading progress** — chapter and overall progress indicators
- **Position memory** — resumes where you left off per book
- **Cross-device sync** — sign in with a passkey to sync books, reading positions, highlights, notebooks, chat sessions, and settings across devices
- **Passkey authentication** — passwordless login via WebAuthn (self-hosted, no third-party auth service)
- **Cloud storage** — epub files and cover images stored in Vercel Blob

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
- [@vercel/blob](https://vercel.com/docs/storage/vercel-blob) — file storage

## Getting Started

```bash
cp .env.example .env.local  # fill in values for sync features
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) and drop an `.epub` file to get started.

The app works fully offline without any environment variables. Sync features require a Postgres database and Vercel Blob storage — see [Environment Variables](#environment-variables) below.

## Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

All environment variables are optional — the app works fully offline without them. Sync features require:

- `DATABASE_URL` — Postgres connection string
- `WEBAUTHN_RP_ID` — WebAuthn Relying Party ID (e.g. `localhost` for dev, your domain for prod)
- `WEBAUTHN_RP_ORIGIN` — WebAuthn origin URL (e.g. `http://localhost:5173` for dev)
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob storage token

## Database Setup

The app uses a `readmax` Postgres schema. Apply the schema files in order:

```bash
psql $DATABASE_URL -f database/readmax/core.sql
```

Migrations are in `database/migrations/` — apply them sequentially.

## Scripts

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `pnpm run dev`       | Start development server     |
| `pnpm run build`     | Production build             |
| `pnpm run start`     | Serve production build       |
| `pnpm run typecheck` | Run TypeScript type checking |
| `pnpm run lint`      | Lint with oxlint             |
| `pnpm run format`    | Format with oxfmt            |

## License

MIT
