import { Sandbox } from "@vercel/sandbox";
import type { FlueNodeApplication } from "@readmaxxing/reading-agent/app";

const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000;
const SANDBOX_PORT = 3000;
const agentModules = import.meta.glob<string>("../../../packages/reading-agent/dist/*.mjs", {
  eager: true,
  import: "default",
  query: "?raw",
});

export interface ReadingAgentHost {
  url: string;
  fetch?: typeof fetch;
  registerAbort(abort: () => Promise<unknown>): void;
  dispose(): Promise<void>;
}

interface AgentHostEnvironment extends NodeJS.ProcessEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

let inProcessApplication: Promise<FlueNodeApplication> | undefined;
const activeHosts = new Map<string, { host: ReadingAgentHost; stop: () => Promise<void> }>();
const creatingHosts = new Map<string, Promise<ReadingAgentHost>>();

export function getActiveReadingAgentHost(conversationId: string): ReadingAgentHost | undefined {
  return activeHosts.get(conversationId)?.host;
}

export function hasActiveReadingAgentHost(conversationId: string): boolean {
  return activeHosts.has(conversationId) || creatingHosts.has(conversationId);
}

function accessTokenCredentials(env: AgentHostEnvironment) {
  const token = env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_TEAM_ID;
  return token && projectId && teamId ? { token, projectId, teamId } : undefined;
}

export function shouldUseVercelReadingAgentHost(env: AgentHostEnvironment = process.env): boolean {
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  return Boolean(production && (env.VERCEL_OIDC_TOKEN || accessTokenCredentials(env)));
}

async function loadInProcessApplication(): Promise<FlueNodeApplication> {
  inProcessApplication ??= import("@readmaxxing/reading-agent/app").then(
    ({ loadFlueNodeApplication }) =>
      loadFlueNodeApplication({ env: process.env, local: process.env.NODE_ENV !== "production" }),
  );
  return inProcessApplication;
}

async function createInProcessHost(conversationId: string): Promise<ReadingAgentHost> {
  const application = await loadInProcessApplication();
  return {
    url: `http://reading-agent.local/agents/reading-scribe/${conversationId}`,
    fetch: async (input, init) => application.fetch(new Request(input, init)),
    registerAbort() {},
    async dispose() {},
  };
}

function sandboxEnvironment(secret: string, env: AgentHostEnvironment): Record<string, string> {
  const keys = [
    "AI_GATEWAY_API_KEY",
    "VERCEL_OIDC_TOKEN",
    "VERCEL_TOKEN",
    "VERCEL_PROJECT_ID",
    "VERCEL_TEAM_ID",
  ] as const;
  return Object.fromEntries([
    ["NODE_ENV", "production"],
    ["PORT", String(SANDBOX_PORT)],
    ["READING_AGENT_SECRET", secret],
    ...keys.flatMap((key) => (env[key] ? [[key, env[key]]] : [])),
  ]);
}

async function waitForSandboxServer(url: string): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  while (!signal.aborted) {
    try {
      await fetch(url, { signal });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw signal.reason;
}

async function createVercelHost(
  conversationId: string,
  secret: string,
  env: AgentHostEnvironment,
): Promise<ReadingAgentHost> {
  const sandbox = await Sandbox.getOrCreate({
    name: `reading-scribe-${conversationId.slice(0, 32)}`,
    runtime: "node24",
    timeout: SANDBOX_TIMEOUT_MS,
    ports: [SANDBOX_PORT],
    env: sandboxEnvironment(secret, env),
    ...accessTokenCredentials(env),
  });
  try {
    const files = Object.entries(agentModules).map(([path, content]) => ({
      path: path.slice(path.lastIndexOf("/") + 1),
      content,
    }));
    if (!files.some(({ path }) => path === "server.mjs")) {
      throw new Error("Reading agent build is missing; run its build before starting the app");
    }
    files.push({
      path: "package.json",
      content: JSON.stringify({
        type: "module",
        dependencies: {
          "@flue/runtime": "2.0.3",
          "@vercel/sandbox": "2.9.2",
          hono: "4.12.15",
          valibot: "1.4.2",
        },
      }),
    });
    await sandbox.writeFiles(files);
    const install = await sandbox.runCommand("npm", [
      "install",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
    ]);
    if (install.exitCode !== 0)
      throw new Error(`Reading agent install failed: ${await install.stderr()}`);
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["server.mjs"],
      detached: true,
      timeoutMs: SANDBOX_TIMEOUT_MS,
    });
    const origin = sandbox.domain(SANDBOX_PORT);
    await waitForSandboxServer(origin);
    return {
      url: `${origin}/agents/reading-scribe/${conversationId}`,
      registerAbort() {},
      async dispose() {
        await command.kill().catch(() => undefined);
        await sandbox.stop().catch(() => undefined);
      },
    };
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
}

export async function createReadingAgentHost(
  conversationId: string,
  secret: string,
  env: AgentHostEnvironment = process.env,
): Promise<ReadingAgentHost> {
  const active = activeHosts.get(conversationId);
  if (active) return active.host;
  const creating = creatingHosts.get(conversationId);
  if (creating) return creating;

  const creation = (async () => {
    const host = shouldUseVercelReadingAgentHost(env)
      ? await createVercelHost(conversationId, secret, env)
      : await createInProcessHost(conversationId);
    let abort = async (): Promise<unknown> => undefined;
    let disposed = false;
    const managedHost: ReadingAgentHost = {
      ...host,
      registerAbort(nextAbort) {
        abort = nextAbort;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (activeHosts.get(conversationId)?.host === managedHost) {
          activeHosts.delete(conversationId);
        }
        await host.dispose();
      },
    };
    const stop = async () => {
      await abort().catch(() => undefined);
      await managedHost.dispose();
    };
    activeHosts.set(conversationId, { host: managedHost, stop });
    return managedHost;
  })();
  creatingHosts.set(conversationId, creation);
  try {
    return await creation;
  } finally {
    if (creatingHosts.get(conversationId) === creation) creatingHosts.delete(conversationId);
  }
}

export async function disposeReadingAgentHost(conversationId: string): Promise<boolean> {
  const active = activeHosts.get(conversationId);
  if (!active) return false;
  await active.host.dispose();
  return true;
}

export async function stopReadingAgentHost(conversationId: string): Promise<boolean> {
  const active = activeHosts.get(conversationId);
  if (!active) return false;
  await active.stop();
  return true;
}
