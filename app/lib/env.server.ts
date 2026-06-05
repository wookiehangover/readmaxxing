import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolConfig } from "pg";

export interface Env {
  readonly R2_FILES?: R2Bucket;
  readonly R2_COVERS?: R2Bucket;
  readonly AGENTS?: DurableObjectNamespace;
  readonly DATABASE_URL?: string;
  readonly PUBLIC_SITE_URL?: string;
  readonly WEBAUTHN_RP_NAME?: string;
  readonly WEBAUTHN_RP_ID?: string;
  readonly WEBAUTHN_RP_ORIGIN?: string;
  readonly ANTHROPIC_API_KEY?: string;
  readonly ANTHROPIC_BASE_URL?: string;
  readonly AI_GATEWAY_API_KEY?: string;
  readonly AI_GATEWAY_BASE_URL?: string;
  readonly AI_GATEWAY_ACCOUNT_ID?: string;
  readonly AI_GATEWAY_NAME?: string;
  readonly SHARE_DOWNLOAD_SECRET?: string;
  readonly NODE_ENV?: string;
}

interface EnvContext {
  readonly env: Env;
  readonly ctx: ExecutionContext;
  pgPool?: Pool;
}

const envStorage = new AsyncLocalStorage<EnvContext>();

(globalThis as { __readmaxxingGetEnv?: () => Env }).__readmaxxingGetEnv = getEnv;
(
  globalThis as {
    __readmaxxingHasRuntimeEnvContext?: () => boolean;
  }
).__readmaxxingHasRuntimeEnvContext = hasRuntimeEnvContext;
(
  globalThis as {
    __readmaxxingGetRuntimePgPool?: () => Pool | undefined;
  }
).__readmaxxingGetRuntimePgPool = getRuntimePgPool;
(
  globalThis as {
    __readmaxxingSetRuntimePgPool?: (pool: Pool) => void;
  }
).__readmaxxingSetRuntimePgPool = setRuntimePgPool;
(
  globalThis as {
    __readmaxxingCreatePgPool?: (config: PoolConfig) => Pool;
  }
).__readmaxxingCreatePgPool = (config) => new Pool(config);

export function runWithEnv<T>(env: Env, ctx: ExecutionContext, callback: () => T): T {
  return envStorage.run({ env, ctx }, callback);
}

export function getEnv(): Env {
  const stored = envStorage.getStore();
  if (stored) return stored.env;

  return getNodeEnvFallback();
}

export function getExecutionContext(): ExecutionContext | undefined {
  return envStorage.getStore()?.ctx;
}

export function hasRuntimeEnvContext(): boolean {
  return Boolean(envStorage.getStore());
}

export function getRuntimePgPool(): Pool | undefined {
  return envStorage.getStore()?.pgPool;
}

export function setRuntimePgPool(pool: Pool): void {
  const stored = envStorage.getStore();
  if (stored) stored.pgPool = pool;
}

export function isDatabaseRuntimeAvailable(): boolean {
  const env = getEnv();

  return Boolean(env.DATABASE_URL);
}

function getNodeEnvFallback(): Env {
  const nodeEnv = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;

  return (nodeEnv ?? {}) as Env;
}
