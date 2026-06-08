/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

import type { Env as AppEnv } from "~/lib/env.server";
import type { AgentNamespace } from "agents";
import type { ChatAgent } from "../workers/chat-agent";

declare global {
  const __SITE_ORIGIN__: string;

  interface CloudflareEnvironment extends Omit<AppEnv, "AGENTS"> {
    readonly AGENTS?: AgentNamespace<ChatAgent>;
  }
}

export {};
