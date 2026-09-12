import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { Client } from "./client.js";
import { Activity, clean, success } from "./terminal.js";
import { DEFAULT_URL, saveConfig, validateToken } from "./config.js";
import { startLoginCallback, type LoginCallback } from "./login-callback.js";

async function connect(url: string, token: string, signal?: AbortSignal) {
  const config = { url, token: validateToken(token) };
  const { user } = await new Client(config).json<{ user: { displayName: string } }>(
    "/api/auth/session",
    { signal },
  );
  signal?.throwIfAborted();
  await saveConfig(config);
  return `Signed in as ${clean(user.displayName)}${url === DEFAULT_URL ? "" : ` · ${url}`}`;
}

function openBrowser(target: string, onFailure: () => void) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const child = spawn(command, [target], { stdio: "ignore", detached: true, shell: false });
  let reported = false;
  const failed = () => {
    if (!reported) onFailure();
    reported = true;
  };
  child.on("error", failed);
  child.on("exit", (code) => {
    if (code) failed();
  });
  child.unref();
}

export async function login(url: string, tokenStdin: boolean, noBrowser: boolean) {
  if (tokenStdin) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024) throw new Error("Invalid token input.");
    }
    success(await new Activity("Signing in").during(() => connect(url, input.trim())));
    return;
  }
  if (!process.stdin.isTTY) throw new Error("Use --token-stdin for non-interactive login.");

  const cancelled = new AbortController();
  let cancel!: () => void;
  const cancellation = new Promise<"cancelled">((resolve) => {
    cancel = () => {
      cancelled.abort();
      resolve("cancelled");
    };
  });
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  // Hidden input remains available if the browser cannot reach this terminal.
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  reader.on("SIGINT", cancel);
  reader.on("close", cancel);
  let callback: LoginCallback | undefined;
  let activity: Activity | undefined;
  try {
    try {
      callback = await startLoginCallback(url, async (token, signal) => {
        activity?.update({ label: "Signing in" });
        try {
          const message = await connect(url, token, AbortSignal.any([signal, cancelled.signal]));
          activity?.stop();
          success(message);
        } catch (error) {
          activity?.update({ label: "Waiting for browser" });
          throw error;
        }
      });
    } catch {
      process.stderr.write("Automatic login unavailable. Paste a browser token.\n");
    }
    if (cancelled.signal.aborted) throw new Error("Login cancelled.");
    const target = new URL("/cli", url);
    if (callback) {
      target.searchParams.set("callback", callback.url);
      target.searchParams.set("state", callback.state);
    }
    if (noBrowser) process.stderr.write(`Open ${target.href}\n`);
    else
      openBrowser(target.href, () => {
        if (cancelled.signal.aborted) return;
        if (activity)
          activity.update({ label: "Waiting for browser", warning: `Open ${target.href}` });
        else process.stderr.write(`\nOpen ${target.href}\n`);
      });

    process.stderr.write(
      callback ? "Finish in your browser · Enter to paste a token\n" : "Token (hidden): ",
    );
    if (callback) activity = new Activity("Waiting for browser");
    const input = () =>
      reader.question("", { signal: cancelled.signal }).then((token) => ({ token: token.trim() }));
    const firstInput = input();
    const first = await Promise.race([
      firstInput,
      cancellation,
      ...(callback ? [callback.result] : []),
    ]);
    if (first === "cancelled") throw new Error("Login cancelled.");
    if (first === "connected") return;

    activity?.stop();
    await callback?.close();
    if (callback && (await callback.result) === "connected") return;
    let token: string;
    if (first === "closed") {
      process.stderr.write("Timed out. Token (hidden): ");
      const fallback = await Promise.race([firstInput, cancellation]);
      if (fallback === "cancelled") throw new Error("Login cancelled.");
      token = fallback.token;
    } else {
      token = first.token;
    }
    if (!token) {
      process.stderr.write("Token (hidden): ");
      const fallback = await Promise.race([input(), cancellation]);
      if (fallback === "cancelled") throw new Error("Login cancelled.");
      token = fallback.token;
    }
    process.stderr.write("\n");
    success(await new Activity("Signing in").during(() => connect(url, token, cancelled.signal)));
  } finally {
    cancelled.abort();
    reader.close();
    activity?.stop();
    await callback?.close();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
