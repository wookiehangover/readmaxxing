import { createAgentRouter } from "@flue/runtime/routing";
import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { ReadingScribe } from "./agents/reading-scribe";

const app = new Hono();

function secretsMatch(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

app.use("/agents/reading-scribe/*", async (context, next) => {
  const expected = process.env.READING_AGENT_SECRET;
  if (!expected) return context.json({ error: "Reading agent secret is not configured" }, 503);
  const authorization = context.req.header("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secretsMatch(provided, expected)) return context.json({ error: "Unauthorized" }, 401);
  await next();
});

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to ReadingScribe with one POST per message:
//
//   curl -X POST http://localhost:5174/agents/reading-scribe/my-first-chat \
//     -H 'content-type: application/json' \
//     -H "authorization: Bearer $READING_AGENT_SECRET" \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route("/agents/reading-scribe", createAgentRouter(ReadingScribe));

export default app;
