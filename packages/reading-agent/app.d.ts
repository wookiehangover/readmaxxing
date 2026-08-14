export interface FlueNodeApplication {
  fetch(request: Request, env?: Record<string, unknown>): Response | Promise<Response>;
  stop(timeoutMs?: number): Promise<void>;
}

export function loadFlueNodeApplication(options?: {
  env?: NodeJS.ProcessEnv;
  local?: boolean;
}): Promise<FlueNodeApplication>;
