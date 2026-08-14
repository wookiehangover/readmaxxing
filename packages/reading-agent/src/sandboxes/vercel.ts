// flue-blueprint: sandbox/vercel@1
/**
 * Vercel Sandbox adapter for Flue.
 *
 * Wraps an already-initialized Vercel Sandbox into Flue's SandboxFactory
 * interface. The user creates and configures the sandbox using the Vercel
 * SDK directly — Flue just adapts it.
 *
 * @example
 * ```typescript
 * 'use agent';
 * import { Sandbox } from '@vercel/sandbox';
 * import { useModel, useSandbox } from '@flue/runtime';
 * import { vercel } from './sandboxes/vercel';
 *
 * export function Assistant() {
 *   useModel('anthropic/claude-sonnet-4-6');
 *   useSandbox({
 *     // Lazy, per the SandboxFactory contract: constructing this object is
 *     // cheap; the expensive Vercel sandbox creation happens once, inside
 *     // createSandbox(), at initialization — never on a re-render.
 *     async createSandbox(options) {
 *       const sandbox = await Sandbox.create({ runtime: 'node24' });
 *       return vercel(sandbox).createSandbox(options);
 *     },
 *   });
 *   return 'You are a helpful assistant with a full sandbox.';
 * }
 * ```
 */
import { sandboxFromDriver } from "@flue/runtime";
import type { SandboxDriver, SandboxFactory, Sandbox, FileStat } from "@flue/runtime";
import type { Sandbox as VercelSandbox } from "@vercel/sandbox";

/**
 * Implements SandboxDriver by wrapping the Vercel Sandbox SDK.
 */
class VercelSandboxDriver implements SandboxDriver {
  constructor(private sandbox: VercelSandbox) {}

  async readFile(path: string): Promise<string> {
    return this.sandbox.fs.readFile(path, "utf8");
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const buffer = await this.sandbox.fs.readFile(path);
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.sandbox.fs.writeFile(path, content);
  }

  async stat(path: string): Promise<FileStat> {
    const stat = await this.sandbox.fs.stat(path);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async readdir(path: string): Promise<string[]> {
    return this.sandbox.fs.readdir(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.sandbox.fs.exists(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.sandbox.fs.mkdir(path, options);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await this.sandbox.fs.rm(path, options);
  }

  async exec(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Vercel's SDK accepts an AbortSignal directly, so we forward both
    // `timeoutMs` (synthesized as a signal) and the caller's `signal`.
    // Compose them with AbortSignal.any so whichever fires first wins:
    //   - timeout-only  → recoverable 124-shape ShellResult.
    //   - caller-only   → rethrow so the host abort propagates.
    //   - both          → if the caller's signal fired, propagate;
    //                     otherwise treat as timeout.
    const timeoutSignal =
      typeof options?.timeoutMs === "number" ? AbortSignal.timeout(options.timeoutMs) : undefined;
    const callerSignal = options?.signal;
    const signal =
      callerSignal && timeoutSignal
        ? AbortSignal.any([callerSignal, timeoutSignal])
        : (callerSignal ?? timeoutSignal);

    try {
      const response = await this.sandbox.runCommand({
        cmd: "bash",
        args: ["-c", command],
        cwd: options?.cwd,
        env: options?.env,
        signal,
      });
      const [stdout, stderr] = await Promise.all([
        response.stdout({ signal }),
        response.stderr({ signal }),
      ]);
      return { stdout, stderr, exitCode: response.exitCode };
    } catch (err) {
      // If the caller's signal fired, rethrow so the host abort wins.
      if (callerSignal?.aborted) throw err;
      const aborted =
        timeoutSignal?.aborted &&
        (err === timeoutSignal.reason ||
          (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")));
      if (aborted) {
        return {
          stdout: "",
          stderr: `[flue:vercel] Command timed out after ${options?.timeoutMs} milliseconds.`,
          exitCode: 124,
        };
      }
      throw err;
    }
  }
}

/**
 * Create a Flue sandbox factory from an initialized Vercel Sandbox.
 * The user owns the sandbox lifecycle; Flue wraps it into a Sandbox
 * for agent use.
 */
export function vercel(sandbox: VercelSandbox): SandboxFactory {
  return {
    async createSandbox(): Promise<Sandbox> {
      const sandboxCwd = "/vercel/sandbox";
      const driver = new VercelSandboxDriver(sandbox);
      return sandboxFromDriver(driver, sandboxCwd);
    },
  };
}
