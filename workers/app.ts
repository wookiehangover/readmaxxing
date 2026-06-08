import { createRequestHandler, type RequestHandler } from "@react-router/cloudflare";
import { runWithEnv, type Env } from "~/lib/env.server";
export { ChatAgent } from "./chat-agent";

type ConsoleWithCreateTask = Console & { createTask?: unknown };
type CloudflareRequestContext = Parameters<RequestHandler<Env>>[0];

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

let requestHandlerPromise: Promise<RequestHandler<Env>> | undefined;

disableUnsupportedConsoleCreateTask();

function disableUnsupportedConsoleCreateTask() {
  const consoleWithTask = console as ConsoleWithCreateTask;
  const noopCreateTask = () => null;

  try {
    Object.defineProperty(consoleWithTask, "createTask", {
      configurable: true,
      value: noopCreateTask,
    });
  } catch {
    consoleWithTask.createTask = noopCreateTask;
  }
}

function getRequestHandler() {
  requestHandlerPromise ??= Promise.resolve(
    createRequestHandler<Env>({
      // Route modules are imported from this lazy build callback during request handling, after runWithEnv() has set ALS.
      build: () => import("virtual:react-router/server-build"),
      getLoadContext: ({ context }) => ({
        cloudflare: {
          env: context.cloudflare.env,
          ctx: context.cloudflare.ctx as unknown as ExecutionContext,
        },
      }),
      mode: import.meta.env.MODE,
    }),
  );

  return requestHandlerPromise;
}

function createCloudflareRequestContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): CloudflareRequestContext {
  return {
    data: {},
    env: Object.assign(Object.create(env), { ASSETS: { fetch } }),
    functionPath: "/",
    next: (input, init) => fetch(input ?? request, init),
    params: {},
    passThroughOnException: () => ctx.passThroughOnException(),
    request: request as CloudflareRequestContext["request"],
    waitUntil: (promise) => ctx.waitUntil(promise),
  };
}

function withRuntimeDefaults(env: Env): Env {
  if (env.NODE_ENV) return env;

  return Object.assign(Object.create(env) as Env, {
    NODE_ENV: import.meta.env.MODE,
  });
}

export default {
  async fetch(request, env, ctx) {
    disableUnsupportedConsoleCreateTask();

    const runtimeEnv = withRuntimeDefaults(env);
    const requestHandler = await getRequestHandler();

    return runWithEnv(runtimeEnv, ctx, () =>
      requestHandler(createCloudflareRequestContext(request, runtimeEnv, ctx)),
    );
  },
} satisfies ExportedHandler<Env>;
