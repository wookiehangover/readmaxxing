# reading-agent

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
pnpm install
```

Then add a model provider API key and `READING_AGENT_SECRET` to `.env`. Use the same
secret in the web app's `.env.local`.

## Talk to your agent

```sh
pnpm exec flue run src/agents/reading-scribe.ts --message "Summarize what I have read."
```

Conversations are durable — pass `--id <id>` to continue one.

## Develop

```sh
pnpm run dev -- --port 5174
```

The ReadingScribe agent is served at `http://localhost:5174/agents/reading-scribe` — see `src/app.ts` for the route map and an authenticated example request.

## Deploy

```sh
pnpm run build
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `pnpm exec flue docs` from the terminal.
