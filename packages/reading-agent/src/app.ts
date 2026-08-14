import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";
import { ReadingScribe } from "./agents/reading-scribe";

const app = new Hono();

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to ReadingScribe with one POST per message:
//
//   curl -X POST http://localhost:5173/agents/reading-scribe/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route("/agents/reading-scribe", createAgentRouter(ReadingScribe));

export default app;
