# reading-agent

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
pnpm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)).

## Talk to your agent

```sh
pnpm exec flue run src/agents/reading-scribe.ts --message "Summarize what I have read."
```

Conversations are durable — pass `--id <id>` to continue one.

## Develop

```sh
pnpm run dev
```

The ReadingScribe agent is served at `http://localhost:5173/agents/reading-scribe` — see `src/app.ts` for the route map and an example request.

## Deploy

```sh
pnpm run build
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `pnpm exec flue docs` from the terminal.
