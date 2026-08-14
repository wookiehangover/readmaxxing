# reading-agent

A [Flue](https://flueframework.com) agent project hosted by the Readmaxxing web app.
Local development runs it in-process; production launches it in a Vercel Sandbox. It is not a
second production deployment.

## Setup

```sh
pnpm install
```

Configure the root app's `.env.local` with `READING_AGENT_SECRET` and its existing
`AI_GATEWAY_API_KEY`. `VERCEL_OIDC_TOKEN` is supported as a Gateway fallback and for production
Sandbox access. `READING_AGENT_URL` is an optional legacy override for an externally hosted agent;
leave it unset for the normal one-app setup.

ReadingScribe keeps the Flue model specifier `anthropic/claude-sonnet-4-6`, but its
Anthropic Messages requests go through `https://ai-gateway.vercel.sh/v1/messages`.
The agent host still boots without Gateway credentials; model calls log/fail for retry without
breaking reader ingest.

## Talk to your agent

```sh
pnpm exec flue run src/agents/reading-scribe.ts --message "Summarize what I have read."
```

Standalone CLI conversations can be continued with `--id <id>`. In the web app, the debug page
observes only the current live lease; Postgres artifacts and revisions are the durable record.

## Develop

Run `pnpm dev` from the repository root. The web app loads ReadingScribe in-process, so no second
server is required. `pnpm run dev` in this package remains available only for isolated agent work.

## Deploy

Build and deploy the root web app. Its build includes the agent modules and launches them in a
Vercel Sandbox in production; do not deploy this package as a separate service.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `pnpm exec flue docs` from the terminal.
