import { Sandbox as VercelSandbox } from "@vercel/sandbox";
import type { SandboxFactory } from "@flue/runtime";
import { createMemorySandbox } from "./memory";
import { vercel } from "./vercel";

function accessTokenCredentials() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  return token && projectId && teamId ? { token, projectId, teamId } : undefined;
}

export function readingSandbox(): SandboxFactory {
  return {
    async createSandbox(options) {
      const credentials = accessTokenCredentials();
      const hasVercelCredentials = Boolean(process.env.VERCEL_OIDC_TOKEN || credentials);
      if (!hasVercelCredentials) return createMemorySandbox();

      const sandbox = await VercelSandbox.create({
        runtime: "node24",
        timeout: 15 * 60 * 1000,
        ...credentials,
      });
      return vercel(sandbox).createSandbox(options);
    },
  };
}
