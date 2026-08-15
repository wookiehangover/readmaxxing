import { Sandbox as VercelSandbox } from "@vercel/sandbox";
import type { SandboxFactory } from "@flue/runtime";
import { createMemorySandbox } from "./memory";
import { vercel } from "./vercel";

interface ReadingSandboxEnvironment extends NodeJS.ProcessEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

function accessTokenCredentials(env: ReadingSandboxEnvironment) {
  const token = env.VERCEL_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_TEAM_ID;
  return token && projectId && teamId ? { token, projectId, teamId } : undefined;
}

export function shouldUseVercelReadingSandbox(
  env: ReadingSandboxEnvironment = process.env,
): boolean {
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
  return Boolean(production && (env.VERCEL_OIDC_TOKEN || accessTokenCredentials(env)));
}

export function readingSandbox(): SandboxFactory {
  return {
    async createSandbox(options) {
      if (!shouldUseVercelReadingSandbox()) return createMemorySandbox();

      const credentials = accessTokenCredentials(process.env);

      const sandbox = await VercelSandbox.create({
        runtime: "node24",
        timeout: 15 * 60 * 1000,
        ...credentials,
      });
      return vercel(sandbox).createSandbox(options);
    },
  };
}
