# reading-agent

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
pnpm install
```

Copy the root app's existing `AI_GATEWAY_API_KEY` into this package's `.env`, then add
`READING_AGENT_SECRET`. Use the same reading-agent secret in the web app's `.env.local`.
`VERCEL_OIDC_TOKEN` is supported as a fallback when the Gateway API key is absent.

ReadingScribe keeps the Flue model specifier `anthropic/claude-sonnet-4-6`, but its
Anthropic Messages requests go through `https://ai-gateway.vercel.sh/v1/messages`.
The sidecar still boots without Gateway credentials; model calls log/fail for retry without
breaking reader ingest.

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
