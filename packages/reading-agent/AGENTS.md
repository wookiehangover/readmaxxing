# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `pnpm exec flue run src/agents/reading-scribe.ts --message "Summarize what I have read."` — run an agent locally, no server.
- `pnpm run dev` — start the dev server.
- `pnpm run build` — build `dist/server.mjs` (start it with `pnpm run start`).
- `pnpm run check:types` — typecheck.
- `pnpm exec flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `pnpm exec flue add` — list blueprints for adding channels, sandboxes, and databases.
